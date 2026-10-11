"""Judging and completion logic with the LLM and database replaced by fakes (no API calls, no DB)."""
import json, pytest
from types import SimpleNamespace
from app.evaluation import llm_json, judge as J, completion as C, human_feedback as HF
from tests.fakedb import FakeDB

# ---------------- ask_json: turning a model reply into JSON ----------------

def fake_model(monkeypatch, reply, seen=None):
    class P:
        async def run(self, node, prompt, inputs):
            if seen is not None: seen.append(node)
            return SimpleNamespace(output=reply, cost_usd=0.01, input_tokens=10, output_tokens=5, model_or_tool=node["model"])
    monkeypatch.setattr(llm_json, "OpenRouterProvider", P)

async def test_json_is_found_inside_prose_and_fences(monkeypatch):
    fake_model(monkeypatch, 'Sure!\n```json\n{"score": 7}\n```\nhope that helps')
    data, meta = await llm_json.ask_json("sys", "user")
    assert data == {"score": 7} and meta["cost_usd"] == 0.01

async def test_unparseable_reply_is_flagged_not_raised(monkeypatch):
    fake_model(monkeypatch, "I think it's about a 7")
    data, _ = await llm_json.ask_json("sys", "user")
    assert data["_parse_error"] is True

async def test_judge_calls_are_deterministic_and_pass_reasoning(monkeypatch):
    seen = []
    fake_model(monkeypatch, "{}", seen)
    await llm_json.ask_json("sys", "user", model="openai/gpt-5.4", reasoning_effort="low")
    p = seen[0]["params"]
    assert seen[0]["model"] == "openai/gpt-5.4" and p["temperature"] == 0 and p["reasoning_effort"] == "low"
    assert "ONLY a JSON object" in seen[0]["system_prompt"]

# ---------------- judge_run: the 3-model panel ----------------

RUN = {"id": "run1", "task_id": "t1", "final_output": "```python\ndef f(): return 1\n```"}
TASK = {"id": "t1", "description": "Write f", "rubric": "returns 1", "test_cases": {"code": "..."}, "reference_output": None}
NODES = [{"node_id": "e", "role": "executor", "node_kind": "llm", "model_or_tool": "m", "loop_index": 0, "input": "", "output": "code", "status": "done"}]

def panel_db():
    return FakeDB([("from runs", RUN), ("from tasks", TASK), ("from node_results", NODES)])

def verdict(score, complete=True):
    return {"nodes": [{"node_id": "e", "accuracy_score": score, "did_its_job": True, "issues": [], "rationale": "ok"}],
            "final": {"accuracy_score": score, "complete": complete, "missing": [], "rationale": "r"}}

def wire(monkeypatch, db, answers, tests=None):
    monkeypatch.setattr(J, "q", db.q); monkeypatch.setattr(J, "one", db.one)
    prompts = []
    async def fake_ask(system, user, model=None, **kw):
        prompts.append(user)
        a = answers[model]
        if isinstance(a, Exception): raise a
        return a, {"cost_usd": 0.01, "model": model}
    monkeypatch.setattr(J, "ask_json", fake_ask)
    async def fake_tests(out, cases): return tests or {"passed": 9, "total": 9, "pass_rate": 1.0, "log": ""}
    monkeypatch.setattr(J, "run_tests", fake_tests)
    return prompts

PANEL = ["anthropic/a", "openai/b", "google/c"]

async def test_panel_averages_three_judges_and_stores_each_verdict(monkeypatch):
    db = panel_db()
    wire(monkeypatch, db, {"anthropic/a": verdict(9), "openai/b": verdict(6, False), "google/c": verdict(9)})
    rep = await J.judge_run("run1", panel=PANEL)
    assert rep["final"]["accuracy_score"] == 8.0 and rep["final"]["complete"] is True and rep["final"]["spread"] == 3.0
    assert rep["cost_usd"] == pytest.approx(0.03)
    inserted = db.writes("insert into judge_results")
    assert len(inserted) == 3 * 2 + 2           # each judge: 1 node row + 1 final row; plus panel node + panel final
    assert sum(1 for p in inserted if "panel" in p) == 2

async def test_one_judge_failing_does_not_break_the_panel(monkeypatch):
    wire(monkeypatch, panel_db(), {"anthropic/a": verdict(8), "openai/b": RuntimeError("402 credits"), "google/c": verdict(10)})
    rep = await J.judge_run("run1", panel=PANEL)
    assert rep["final"]["accuracy_score"] == 9.0
    failed = [j for j in rep["judges"] if not j["ok"]]
    assert len(failed) == 1 and "402" in failed[0]["error"]

async def test_all_judges_failing_raises_clear_error(monkeypatch):
    wire(monkeypatch, panel_db(), {m: RuntimeError("down") for m in PANEL})
    with pytest.raises(RuntimeError, match="all judges failed"):
        await J.judge_run("run1", panel=PANEL)

async def test_judges_are_told_the_hidden_test_results(monkeypatch):
    prompts = wire(monkeypatch, panel_db(), {m: verdict(9) for m in PANEL},
                   tests={"passed": 7, "total": 9, "pass_rate": 7 / 9, "log": "FAILED test_x"})
    await J.judge_run("run1", panel=PANEL)
    assert "7/9 passed" in prompts[0] and "FAILED test_x" in prompts[0] and "ground truth" in prompts[0]

# ---------------- evaluate_run: complete / partial / failed ----------------

def completion_db(run_status="done", judge=None, human=None, interventions=0, test_cases=None, final="```python\nx=1\n```"):
    run = {"id": "run1", "task_id": "t1", "status": run_status, "error": "boom" if run_status == "failed" else None,
           "final_output": final, "total_cost": 0.01, "total_latency_ms": 1000}
    return FakeDB([("from runs", run), ("from tasks", {"id": "t1", "test_cases": test_cases}),
                   ("from judge_results", judge), ("from human_feedback", human),
                   ("from checkpoints", {"c": interventions}), ("insert into evaluations", [])])

async def evaluate_with(monkeypatch, db, tests=None):
    monkeypatch.setattr(C, "q", db.q); monkeypatch.setattr(C, "one", db.one)
    async def fake_tests(out, cases): return tests
    monkeypatch.setattr(C, "run_tests", fake_tests)
    return await C.evaluate_run("run1")

async def test_tests_decide_when_they_exist(monkeypatch):
    db = completion_db(test_cases={"code": "x"}, judge={"accuracy_score": 10, "complete": True})
    res = await evaluate_with(monkeypatch, db, {"passed": 8, "total": 9, "pass_rate": 8 / 9, "log": ""})
    assert res["completion_status"] == "partial" and res["completion_reason"] == "tests 8/9 passed"

async def test_all_tests_passing_is_complete_and_none_is_failed(monkeypatch):
    ok = await evaluate_with(monkeypatch, completion_db(test_cases={"code": "x"}), {"passed": 9, "total": 9, "pass_rate": 1.0, "log": ""})
    bad = await evaluate_with(monkeypatch, completion_db(test_cases={"code": "x"}), {"passed": 0, "total": 9, "pass_rate": 0.0, "log": ""})
    assert ok["completion_status"] == "complete" and bad["completion_status"] == "failed"

async def test_human_decides_when_no_tests(monkeypatch):
    res = await evaluate_with(monkeypatch, completion_db(human={"rating": 2, "complete": False}, judge={"accuracy_score": 10, "complete": True}))
    assert res["completion_status"] == "partial" and "human marked incomplete" in res["completion_reason"]

async def test_judge_decides_last_with_threshold_7(monkeypatch):
    hi = await evaluate_with(monkeypatch, completion_db(judge={"accuracy_score": 7, "complete": True}))
    lo = await evaluate_with(monkeypatch, completion_db(judge={"accuracy_score": 6.5, "complete": True}))
    assert hi["completion_status"] == "complete" and lo["completion_status"] == "partial"

async def test_failed_run_is_failed_whatever_the_judges_say(monkeypatch):
    res = await evaluate_with(monkeypatch, completion_db(run_status="failed", judge={"accuracy_score": 10, "complete": True}))
    assert res["completion_status"] == "failed" and "boom" in res["completion_reason"]

async def test_quality_score_is_saved_out_of_100(monkeypatch):
    db = completion_db(test_cases={"code": "x"}, judge={"accuracy_score": 9, "complete": True})
    res = await evaluate_with(monkeypatch, db, {"passed": 9, "total": 9, "pass_rate": 1.0, "log": ""})
    assert res["composite_score"] == 95.0
    assert db.writes("insert into evaluations")[0][-1] == 95.0

async def test_no_evaluation_yet(monkeypatch):
    res = await evaluate_with(monkeypatch, completion_db())
    assert res["completion_status"] == "partial" and res["completion_reason"] == "no evaluation yet" and res["composite_score"] is None

# ---------------- human feedback ----------------

async def test_vague_feedback_fallback_when_model_reply_unreadable(monkeypatch):
    db = FakeDB([("final_output from runs", {"final_output": "x"}), ("from judge_results", None),
                 ("distinct node_id", [{"node_id": "e"}]), ("insert into human_feedback", lambda s, p: {"id": "h1", "rating": p[2]})])
    monkeypatch.setattr(HF, "q", db.q); monkeypatch.setattr(HF, "one", db.one)
    async def bad_json(*a, **k): return {"_parse_error": True}, {"cost_usd": 0}
    monkeypatch.setattr(HF, "ask_json", bad_json)
    res = await HF.parse_feedback("run1", None, 2, False, "meh")
    assert res["parsed_verdict"]["feedback_quality"] == "vague" and res["rating"] == 2
