"""LLM-as-a-judge, run as a PANEL: several judge models from different companies score every node and the
final output independently; the app stores each verdict plus an aggregated 'panel' verdict (mean score,
majority vote) and reports how much the judges disagree (spread = max - min)."""
import asyncio, json
from statistics import mean
from app.config import JUDGE_PANEL
from app.evaluation.llm_json import ask_json
from app.evaluation.tests_runner import run_tests
from app.db.client import q, one

SYSTEM = """You are a strict, fair evaluator of a team of AI agents that worked on a task.
Score accuracy 0-10. 'did_its_job' means the node fulfilled its role (a reviewer that approved broken work did NOT).
'complete' for the final output means the task is fully done as specified.
If hidden test results are provided they are ground truth for correctness: never contradict them. Use your judgement
for what tests cannot measure: readability, robustness, edge cases they missed, and whether each role did its job."""

PANEL = "panel"

def _clip(s, n=4000): return (s or "")[:n]

def _majority(votes: list) -> bool | None:
    v = [x for x in votes if x is not None]
    if not v: return None
    return sum(1 for x in v if x) > len(v) / 2          # ties -> False (strict)

def aggregate(verdicts: list[dict]) -> dict:
    """verdicts: [{"model": str, "data": {"nodes": [...], "final": {...}}}] from judges that answered.
    Returns {"nodes": [...], "final": {...}} with mean scores, majority votes, merged issues, per-judge scores and spread."""
    def merged_issues(lists, cap=6):
        out = []
        for l in lists:
            for i in (l or []):
                if isinstance(i, str) and i.strip() and i.strip().lower() not in {x.lower() for x in out}:
                    out.append(i.strip())
        return out[:cap]
    node_ids = []
    for v in verdicts:
        for n in v["data"].get("nodes", []):
            if n.get("node_id") and n["node_id"] not in node_ids: node_ids.append(n["node_id"])
    nodes = []
    for nid in node_ids:
        per = [(v["model"], n) for v in verdicts for n in v["data"].get("nodes", []) if n.get("node_id") == nid]
        scores = [float(n["accuracy_score"]) for _, n in per if isinstance(n.get("accuracy_score"), (int, float))]
        nodes.append({
            "node_id": nid,
            "accuracy_score": round(mean(scores), 1) if scores else None,
            "did_its_job": _majority([n.get("did_its_job") for _, n in per]),
            "issues": merged_issues([n.get("issues") for _, n in per]),
            "rationale": " | ".join(f"{m.split('/')[-1]}: {n.get('rationale', '')}" for m, n in per),
            "by_judge": {m: n.get("accuracy_score") for m, n in per},
            "spread": round(max(scores) - min(scores), 1) if len(scores) > 1 else 0.0,
        })
    finals = [(v["model"], v["data"].get("final") or {}) for v in verdicts]
    fs = [float(f["accuracy_score"]) for _, f in finals if isinstance(f.get("accuracy_score"), (int, float))]
    final = {
        "accuracy_score": round(mean(fs), 1) if fs else None,
        "complete": _majority([f.get("complete") for _, f in finals]),
        "missing": merged_issues([f.get("missing") for _, f in finals]),
        "rationale": " | ".join(f"{m.split('/')[-1]} ({f.get('accuracy_score')}/10): {f.get('rationale', '')}" for m, f in finals),
        "by_judge": {m: f.get("accuracy_score") for m, f in finals},
        "spread": round(max(fs) - min(fs), 1) if len(fs) > 1 else 0.0,
    }
    return {"nodes": nodes, "final": final}

async def _ask(model: str, user: str) -> dict:
    try:
        # thinking models need room for reasoning + the JSON answer
        data, meta = await ask_json(SYSTEM, user, model=model, max_tokens=6000, reasoning_effort="low")
        if data.get("_parse_error"):
            return {"model": model, "error": "reply was not valid JSON", "cost_usd": meta["cost_usd"]}
        return {"model": model, "data": data, "cost_usd": meta["cost_usd"]}
    except Exception as ex:
        return {"model": model, "error": f"{type(ex).__name__}: {str(ex)[:160]}", "cost_usd": 0.0}

async def judge_run(run_id: str, panel: list[str] | None = None) -> dict:
    panel = panel or JUDGE_PANEL
    run = one("select * from runs where id=%s", (run_id,))
    task = one("select * from tasks where id=%s", (run["task_id"],))
    nodes = q("select node_id, role, node_kind, model_or_tool, loop_index, input, output, status from node_results where run_id=%s order by ts", (run_id,))
    latest = {}
    for n in nodes: latest[n["node_id"]] = n          # latest attempt per node
    node_blocks = "\n\n".join(
        f"### node {k} | role={v['role'] or v['node_kind']} | model={v['model_or_tool']} | attempt={v['loop_index']}\n"
        f"OUTPUT:\n{_clip(v['output'])}" for k, v in latest.items())

    tests_block = ""
    if task.get("test_cases") and run.get("final_output"):
        t = await run_tests(run["final_output"], task["test_cases"])
        tests_block = (f"# Hidden test results (ground truth for correctness)\n{t['passed']}/{t['total']} passed."
                       + (f"\nTest log tail:\n{t['log'][-800:]}" if t["passed"] < t["total"] or not t["total"] else ""))

    user = f"""# Task
{task['description']}
# Success criteria / rubric
{task.get('rubric') or 'Infer reasonable criteria from the task.'}
{('# Reference answer' + chr(10) + _clip(task['reference_output'])) if task.get('reference_output') else ''}
{tests_block}

# Node outputs
{node_blocks}

# Final output
{_clip(run['final_output'], 6000)}

Return JSON:
{{"nodes": [{{"node_id": str, "accuracy_score": 0-10, "did_its_job": bool, "issues": [str], "rationale": str}}],
 "final": {{"accuracy_score": 0-10, "complete": bool, "missing": [str], "rationale": str}}}}"""

    results = await asyncio.gather(*(_ask(m, user) for m in panel))
    ok = [r for r in results if "data" in r]
    if not ok:
        raise RuntimeError("all judges failed: " + "; ".join(f"{r['model']}: {r['error']}" for r in results))

    q("delete from judge_results where run_id=%s", (run_id,))
    for r in ok:   # each judge's own verdict (cost recorded on its final-output row)
        for n in r["data"].get("nodes", []):
            q("""insert into judge_results (run_id,node_id,accuracy_score,did_its_job,issues,rationale,judge_model,judge_cost_usd)
                 values (%s,%s,%s,%s,%s,%s,%s,0)""",
              (run_id, n.get("node_id"), n.get("accuracy_score"), n.get("did_its_job"), json.dumps(n.get("issues", [])), n.get("rationale"), r["model"]))
        f = r["data"].get("final") or {}
        q("""insert into judge_results (run_id,node_id,accuracy_score,complete,issues,rationale,judge_model,judge_cost_usd)
             values (%s,NULL,%s,%s,%s,%s,%s,%s)""",
          (run_id, f.get("accuracy_score"), f.get("complete"), json.dumps(f.get("missing", [])), f.get("rationale"), r["model"], r["cost_usd"]))

    agg = aggregate(ok)
    for n in agg["nodes"]:   # the panel's combined verdict (cost 0 here so totals aren't double-counted)
        q("""insert into judge_results (run_id,node_id,accuracy_score,did_its_job,issues,rationale,judge_model,judge_cost_usd)
             values (%s,%s,%s,%s,%s,%s,%s,0)""",
          (run_id, n["node_id"], n["accuracy_score"], n["did_its_job"], json.dumps(n["issues"]), n["rationale"], PANEL))
    f = agg["final"]
    q("""insert into judge_results (run_id,node_id,accuracy_score,complete,issues,rationale,judge_model,judge_cost_usd)
         values (%s,NULL,%s,%s,%s,%s,%s,0)""",
      (run_id, f["accuracy_score"], f["complete"], json.dumps(f["missing"]), f["rationale"], PANEL))

    return {"nodes": agg["nodes"], "final": f,
            "judges": [{"model": r["model"], "ok": "data" in r, "error": r.get("error"),
                        "final_score": (r.get("data") or {}).get("final", {}).get("accuracy_score"), "cost_usd": r["cost_usd"]} for r in results],
            "cost_usd": round(sum(r["cost_usd"] for r in results), 6)}
