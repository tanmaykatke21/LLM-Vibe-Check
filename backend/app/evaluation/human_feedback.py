"""Turn a human's rating + free text into a structured verdict, and rate the feedback itself."""
import json
from app.evaluation.llm_json import ask_json
from app.db.client import q, one

SYSTEM = """You read a human reviewer's feedback on an AI team's output and structure it.
feedback_quality: 'useful' (specific, actionable), 'vague' (e.g. 'fine', 'bad'), or 'contradictory' (rating and text disagree).
blamed_nodes: node ids the feedback implies were at fault (may be empty)."""

async def parse_feedback(run_id: str, node_id: str | None, rating: int, complete: bool | None, text: str) -> dict:
    run = one("select final_output from runs where id=%s", (run_id,))
    judge_final = one("select accuracy_score, complete from judge_results where run_id=%s and node_id is null order by (judge_model='panel') desc, created_at desc limit 1", (run_id,))
    nodes = [r["node_id"] for r in q("select distinct node_id from node_results where run_id=%s", (run_id,))]
    user = f"""Rating: {rating}/5. Marked complete: {complete}.
Feedback text: {text or '(none)'}
Node ids in this run: {nodes}
LLM judge said: {dict(judge_final) if judge_final else 'not run yet'}
Output being reviewed (first 2000 chars): {(run['final_output'] or '')[:2000]}

Return JSON: {{"sentiment": "positive|neutral|negative", "complete": bool, "issues": [str], "blamed_nodes": [str],
"feedback_quality": "useful|vague|contradictory", "agrees_with_judge": bool|null, "summary": str}}"""
    data, meta = await ask_json(SYSTEM, user, max_tokens=800)
    if data.get("_parse_error"):
        data = {"sentiment": "neutral", "complete": complete, "issues": [], "blamed_nodes": [],
                "feedback_quality": "vague" if len(text.strip()) < 15 else "useful", "agrees_with_judge": None, "summary": text[:200]}
    row = one("""insert into human_feedback (run_id,node_id,rating,complete,feedback_text,parsed_verdict,feedback_quality,agrees_with_judge)
                 values (%s,%s,%s,%s,%s,%s,%s,%s) returning *""",
              (run_id, node_id, rating, complete if complete is not None else data.get("complete"), text, json.dumps(data),
               data.get("feedback_quality"), data.get("agrees_with_judge")))
    return {**row, "parsed_verdict": data}
