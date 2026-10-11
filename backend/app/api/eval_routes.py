import asyncio, logging, httpx
from fastapi import APIRouter, HTTPException
from app.db.client import q, one
from app.schemas import ForkIn, FeedbackIn
from app.evaluation.judge import judge_run
from app.evaluation.human_feedback import parse_feedback
from app.evaluation.completion import evaluate_run
from app.evaluation.scoring import score_runs, quality_score
from app.core.fork import create_fork, fork_tree
from app.schemas import RunIn

r = APIRouter()

def _provider_error(ex: httpx.HTTPStatusError) -> str:
    code = ex.response.status_code
    hint = {402: "OpenRouter: out of credits — top up at openrouter.ai/credits", 401: "OpenRouter: invalid API key",
            404: "OpenRouter: model id not found", 429: "OpenRouter: rate limited, retry shortly"}.get(code, "")
    try: body = ex.response.json().get("error", {}).get("message", "")
    except Exception: body = ex.response.text[:200]
    return f"LLM provider error {code}. {hint} {body}".strip()

@r.post("/runs/{rid}/evaluate")
async def evaluate(rid: str, weights: dict | None = None):
    run = one("select status from runs where id=%s", (rid,))
    if not run: raise HTTPException(404)
    if run["status"] != "done": raise HTTPException(409, f"run is {run['status']}")
    try:
        judge = await judge_run(rid)
    except httpx.HTTPStatusError as ex:
        raise HTTPException(502, _provider_error(ex))
    summary = await evaluate_run(rid, weights)
    return {**summary, "judge_report": judge}

@r.post("/runs/{rid}/feedback")
async def feedback(rid: str, f: FeedbackIn):
    if not one("select 1 from runs where id=%s", (rid,)): raise HTTPException(404)
    try:
        fb = await parse_feedback(rid, f.node_id, f.rating, f.complete, f.feedback_text)
    except httpx.HTTPStatusError as ex:
        raise HTTPException(502, _provider_error(ex))
    summary = await evaluate_run(rid)
    return {"feedback": fb, **summary}

def _panel_or_all(rid: str):
    rows = q("select * from judge_results where run_id=%s and judge_model='panel' order by node_id nulls last", (rid,))
    return rows or q("select * from judge_results where run_id=%s order by node_id nulls last", (rid,))

@r.get("/runs/{rid}/evaluation")
def get_evaluation(rid: str):
    ev = one("select * from evaluations where run_id=%s", (rid,))
    if ev:   # recompute so runs scored with the old formula show the 0-100 quality score too
        ev["composite_score"] = quality_score(ev["final_judge_score"], ev["test_pass_rate"], ev["human_score"])
    return {"evaluation": ev,
            # combined panel verdict (falls back to single-judge rows for runs judged before the panel existed)
            "judge": _panel_or_all(rid),
            "judge_panel": q("select * from judge_results where run_id=%s and judge_model <> 'panel' order by node_id nulls last, judge_model", (rid,)),
            "human": q("select * from human_feedback where run_id=%s order by created_at", (rid,))}

@r.post("/runs/{rid}/fork")
async def fork(rid: str, body: ForkIn):
    try:
        return await create_fork(rid, body.from_node_id, body.node_changes)
    except ValueError as ex:
        raise HTTPException(400, str(ex))

@r.get("/runs/{rid}/forks")
def forks(rid: str):
    if not one("select 1 from runs where id=%s", (rid,)): raise HTTPException(404)
    return fork_tree(rid)

@r.post("/compare")
async def compare(body: dict):
    """body: {task_id, weights?} -> ranked runs for that task."""
    rows = q("""select r.id, r.session_id, s.name session_name, r.status, r.total_cost, r.total_latency_ms, r.total_input_tokens,
                r.total_output_tokens, r.human_wait_ms, r.created_at, r.parent_run_id, r.forked_from_node, e.composite_score, e.completion_status, e.final_judge_score,
                e.test_pass_rate, e.human_score, e.interventions_count,
                (select max(j.accuracy_score) - min(j.accuracy_score) from judge_results j
                  where j.run_id=r.id and j.node_id is null and j.judge_model <> 'panel') judge_spread,
                (select count(*) from judge_results j where j.run_id=r.id and j.node_id is null and j.judge_model <> 'panel') judge_count
                from runs r join sessions s on s.id=r.session_id left join evaluations e on e.run_id=r.id
                where r.task_id=%s and r.status='done' order by e.composite_score desc nulls last, r.total_cost asc""", (body["task_id"],))
    # overall 0-100 = quality x (1 - penalty for being pricier/slower than the best squad on this task)
    score_runs(rows, body.get("weights"))
    rows.sort(key=lambda x: (x["composite_score"] is not None, x["composite_score"] or 0, -float(x["total_cost"] or 0)), reverse=True)
    try:
        ids = [str(x["id"]) for x in rows]
        parts = q("""select run_id, node_id, coalesce(role, node_kind) role, node_kind, model_or_tool, count(*) calls,
                     max(loop_index) max_loop, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens,
                     sum(cost_usd) cost_usd, sum(latency_ms) latency_ms, bool_or(reused_from_run_id is not null) reused
                     from node_results where run_id = any(%s::uuid[]) group by run_id, node_id, role, node_kind, model_or_tool
                     order by min(ts)""", (ids,)) if ids else []
        by_run: dict[str, list] = {}
        for part in parts:
            by_run.setdefault(str(part.pop("run_id")), []).append(part)
        for row in rows:
            nodes = by_run.get(str(row["id"]), [])
            row["nodes"] = nodes
            row["models"] = sorted({n["model_or_tool"] for n in nodes if n["node_kind"] != "checkpoint" and n["model_or_tool"]})
            row["llm_calls"] = sum(int(n["calls"]) for n in nodes if n["node_kind"] == "llm")
            row["loops_used"] = max([int(n["max_loop"] or 0) for n in nodes] or [0])
    except Exception as ex:  # breakdown is optional; never break ranking
        for row in rows: row.setdefault("nodes", []); row["breakdown_error"] = repr(ex)
    return {"task_id": body["task_id"], "ranked": rows}


# ---------- repeat runs (reliability / cost per correct answer) ----------
log = logging.getLogger("repeat")
_bg: set[asyncio.Task] = set()   # keep references so background tasks are not garbage-collected

async def _judge_when_done(rid: str, timeout_s: int = 1800):
    """Wait for a run to finish, then judge + score it (same as clicking 'Run judge')."""
    for _ in range(timeout_s // 3):
        row = one("select status from runs where id=%s", (rid,))
        if row and row["status"] in ("done", "failed"): break
        await asyncio.sleep(3)
    else:
        return
    if row["status"] != "done": return
    try:
        await judge_run(rid)
        await evaluate_run(rid)
    except Exception as ex:  # judge failure must not crash the server; run stays unjudged
        log.warning("auto-judge failed for %s: %s", rid, ex)

@r.post("/runs/repeat")
async def repeat_runs(body: dict):
    """body: {session_id, task_id, n (1-5)} -> start n runs of the same squad on the same task; each is auto-judged."""
    from app.api.routes import start_run
    n = max(1, min(int(body.get("n", 3)), 5))
    runs = []
    for _ in range(n):
        run = await start_run(RunIn(session_id=body["session_id"], task_id=body["task_id"]))
        rid = str(run["id"]); runs.append({"id": rid})
        t = asyncio.create_task(_judge_when_done(rid)); _bg.add(t); t.add_done_callback(_bg.discard)
    return {"runs": runs}
