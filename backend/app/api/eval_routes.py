import httpx
from fastapi import APIRouter, HTTPException
from app.db.client import q, one
from app.schemas import ForkIn, FeedbackIn
from app.evaluation.judge import judge_run
from app.evaluation.human_feedback import parse_feedback
from app.evaluation.completion import evaluate_run
from app.core.fork import create_fork, fork_tree

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

@r.get("/runs/{rid}/evaluation")
def get_evaluation(rid: str):
    return {"evaluation": one("select * from evaluations where run_id=%s", (rid,)),
            "judge": q("select * from judge_results where run_id=%s order by node_id nulls last", (rid,)),
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
                r.total_output_tokens, r.parent_run_id, r.forked_from_node, e.composite_score, e.completion_status, e.final_judge_score,
                e.test_pass_rate, e.human_score, e.interventions_count
                from runs r join sessions s on s.id=r.session_id left join evaluations e on e.run_id=r.id
                where r.task_id=%s and r.status='done' order by e.composite_score desc nulls last, r.total_cost asc""", (body["task_id"],))
    if body.get("weights"):
        for row in rows:
            row["composite_score"] = (await evaluate_run(str(row["id"]), body["weights"]))["composite_score"]
        rows.sort(key=lambda x: x["composite_score"] or -9, reverse=True)
    return {"task_id": body["task_id"], "ranked": rows}
