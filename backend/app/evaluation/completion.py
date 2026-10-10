"""Combine tests > human > judge into one completion status + composite score."""
from app.db.client import q, one
from app.evaluation.tests_runner import run_tests

DEFAULT_WEIGHTS = {"quality": 1.0, "tests": 1.0, "human": 0.5, "cost": 0.3, "speed": 0.2, "effort": 0.2}
JUDGE_THRESHOLD = 7.0

async def evaluate_run(run_id: str, weights: dict | None = None) -> dict:
    w = {**DEFAULT_WEIGHTS, **(weights or {})}
    run = one("select * from runs where id=%s", (run_id,))
    task = one("select * from tasks where id=%s", (run["task_id"],))
    judge = one("select accuracy_score, complete from judge_results where run_id=%s and node_id is null order by created_at desc limit 1", (run_id,))
    human = one("select rating, complete from human_feedback where run_id=%s and node_id is null order by created_at desc limit 1", (run_id,))
    interventions = one("select count(*) c from checkpoints where run_id=%s and status in ('edited','rejected')", (run_id,))["c"]

    tests = None
    if task.get("test_cases") and run.get("final_output"):
        tests = await run_tests(run["final_output"], task["test_cases"])

    # completion rule: tests > human > judge
    if run["status"] != "done":
        status, reason = "failed", f"run {run['status']}: {run.get('error') or ''}"
    elif tests is not None and tests["total"]:
        status = "complete" if tests["pass_rate"] == 1.0 else ("partial" if tests["pass_rate"] > 0 else "failed")
        reason = f"tests {tests['passed']}/{tests['total']} passed"
    elif human and human["complete"] is not None:
        status = "complete" if (human["complete"] or human["rating"] >= 4) else "partial"
        reason = f"human marked {'complete' if human['complete'] else 'incomplete'} (rating {human['rating']}/5)"
    elif judge:
        ok = bool(judge["complete"]) and float(judge["accuracy_score"] or 0) >= JUDGE_THRESHOLD
        status = "complete" if ok else "partial"
        reason = f"judge: complete={judge['complete']}, accuracy={judge['accuracy_score']}/10"
    else:
        status, reason = "partial", "no evaluation yet"

    # composite (normalize cost to $ per run, latency to seconds)
    quality = float(judge["accuracy_score"]) / 10 if judge and judge["accuracy_score"] is not None else 0.5
    tests_score = tests["pass_rate"] if tests else quality
    human_score = (float(human["rating"]) / 5) if human else quality
    cost = float(run["total_cost"] or 0); secs = (run["total_latency_ms"] or 0) / 1000
    composite = (w["quality"] * quality + w["tests"] * tests_score + w["human"] * human_score
                 - w["cost"] * min(cost, 1.0) - w["speed"] * min(secs / 60, 1.0) - w["effort"] * min(interventions / 3, 1.0))
    q("""insert into evaluations (run_id,test_pass_rate,final_judge_score,human_score,completion_status,completion_reason,interventions_count,composite_score)
         values (%s,%s,%s,%s,%s,%s,%s,%s)
         on conflict (run_id) do update set test_pass_rate=excluded.test_pass_rate, final_judge_score=excluded.final_judge_score,
         human_score=excluded.human_score, completion_status=excluded.completion_status, completion_reason=excluded.completion_reason,
         interventions_count=excluded.interventions_count, composite_score=excluded.composite_score, updated_at=now()""",
      (run_id, tests["pass_rate"] if tests else None, judge["accuracy_score"] if judge else None,
       human["rating"] if human else None, status, reason, interventions, round(composite, 3)))
    return {"run_id": run_id, "completion_status": status, "completion_reason": reason, "tests": tests,
            "judge": dict(judge) if judge else None, "human": dict(human) if human else None,
            "interventions": interventions, "composite_score": round(composite, 3), "weights": w}
