"""LLM-as-a-judge: scores every node's output and the final output."""
import json
from app.evaluation.llm_json import ask_json
from app.db.client import q, one

SYSTEM = """You are a strict, fair evaluator of a team of AI agents that worked on a task.
Score accuracy 0-10. 'did_its_job' means the node fulfilled its role (a reviewer that approved broken work did NOT).
'complete' for the final output means the task is fully done as specified."""

def _clip(s, n=4000): return (s or "")[:n]

async def judge_run(run_id: str) -> dict:
    run = one("select * from runs where id=%s", (run_id,))
    task = one("select * from tasks where id=%s", (run["task_id"],))
    nodes = q("select node_id, role, node_kind, model_or_tool, loop_index, input, output, status from node_results where run_id=%s order by ts", (run_id,))
    # latest attempt per node
    latest = {}
    for n in nodes: latest[n["node_id"]] = n
    node_blocks = "\n\n".join(
        f"### node {k} | role={v['role'] or v['node_kind']} | model={v['model_or_tool']} | attempt={v['loop_index']}\n"
        f"OUTPUT:\n{_clip(v['output'])}" for k, v in latest.items())
    user = f"""# Task
{task['description']}
# Success criteria / rubric
{task.get('rubric') or 'Infer reasonable criteria from the task.'}
{('# Reference answer' + chr(10) + _clip(task['reference_output'])) if task.get('reference_output') else ''}

# Node outputs
{node_blocks}

# Final output
{_clip(run['final_output'], 6000)}

Return JSON:
{{"nodes": [{{"node_id": str, "accuracy_score": 0-10, "did_its_job": bool, "issues": [str], "rationale": str}}],
 "final": {{"accuracy_score": 0-10, "complete": bool, "missing": [str], "rationale": str}}}}"""
    data, meta = await ask_json(SYSTEM, user)
    q("delete from judge_results where run_id=%s", (run_id,))
    for n in data.get("nodes", []):
        q("""insert into judge_results (run_id,node_id,accuracy_score,did_its_job,issues,rationale,judge_model,judge_cost_usd)
             values (%s,%s,%s,%s,%s,%s,%s,0)""",
          (run_id, n.get("node_id"), n.get("accuracy_score"), n.get("did_its_job"), json.dumps(n.get("issues", [])), n.get("rationale"), meta["model"]))
    f = data.get("final", {})
    q("""insert into judge_results (run_id,node_id,accuracy_score,complete,issues,rationale,judge_model,judge_cost_usd)
         values (%s,NULL,%s,%s,%s,%s,%s,%s)""",
      (run_id, f.get("accuracy_score"), f.get("complete"), json.dumps(f.get("missing", [])), f.get("rationale"), meta["model"], meta["cost_usd"]))
    return {"nodes": data.get("nodes", []), "final": f, "judge": meta, "parse_error": data.get("_parse_error", False)}
