"""HTTP API with the database and background runs replaced by fakes (FastAPI TestClient; no server needed)."""
import asyncio, httpx, pytest
from fastapi.testclient import TestClient
from app.main import app
from app.api import routes as RT, eval_routes as EV
from app.core import run_manager as RM
from tests.fakedb import FakeDB

client = TestClient(app)          # not used as a context manager, so startup (live price download) is skipped

def use_db(monkeypatch, db, *modules):
    for m in modules or (RT, EV):
        monkeypatch.setattr(m, "q", db.q); monkeypatch.setattr(m, "one", db.one)

def test_models_lists_llms_and_tools():
    d = client.get("/models").json()
    assert d["tools"] == ["elevenlabs.tts", "elevenlabs.stt"] and any(m["id"] == "anthropic/claude-haiku-5.5" for m in d["llms"])

def test_graph_validate_endpoint():
    ok = client.post("/graph/validate", json={"nodes": [{"id": "a", "kind": "llm", "model": "m"}], "edges": []}).json()
    bad = client.post("/graph/validate", json={"nodes": [{"id": "a", "kind": "llm"}], "edges": []}).json()
    assert ok == {"valid": True, "problems": []} and bad["valid"] is False

def test_health_reports_database_down(monkeypatch):
    import app.db.client as dbc
    def down(*a, **k): raise ConnectionError("no db")
    monkeypatch.setattr(dbc, "one", down)
    d = client.get("/health").json()
    assert d["status"] == "degraded" and "docker start squad-db" in d["db"]

def test_unknown_task_is_404(monkeypatch):
    use_db(monkeypatch, FakeDB([("from tasks", None)]))
    assert client.get("/tasks/nope").status_code == 404

def test_feedback_rating_must_be_1_to_5():
    assert client.post("/runs/x/feedback", json={"rating": 9}).status_code == 422

def test_starting_a_run_with_an_invalid_squad_is_400(monkeypatch):
    use_db(monkeypatch, FakeDB([("from sessions", {"id": "s", "graph": {"nodes": [{"id": "a", "kind": "llm"}], "edges": []}}),
                                ("from tasks", {"id": "t"})]))
    r = client.post("/runs", json={"session_id": "s", "task_id": "t"})
    assert r.status_code == 400 and "needs a model" in str(r.json())

def test_evaluating_unfinished_or_missing_runs(monkeypatch):
    use_db(monkeypatch, FakeDB([("from runs", {"status": "running"})]))
    assert client.post("/runs/r1/evaluate", json={}).status_code == 409
    use_db(monkeypatch, FakeDB([("from runs", None)]))
    assert client.post("/runs/r1/evaluate", json={}).status_code == 404

def test_out_of_credits_becomes_readable_502(monkeypatch):
    use_db(monkeypatch, FakeDB([("from runs", {"status": "done"})]))
    req = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    resp = httpx.Response(402, json={"error": {"message": "Insufficient credits"}}, request=req)
    async def boom(rid): raise httpx.HTTPStatusError("402", request=req, response=resp)
    monkeypatch.setattr(EV, "judge_run", boom)
    r = client.post("/runs/r1/evaluate", json={})
    assert r.status_code == 502 and "out of credits" in r.json()["detail"] and "Insufficient credits" in r.json()["detail"]

def test_checkpoint_decisions(monkeypatch):
    loop = asyncio.new_event_loop()
    fut = loop.create_future()
    monkeypatch.setitem(RM._live, "run1", type("Ctx", (), {"checkpoint_decisions": {"c": fut}})())
    assert client.post("/runs/none/checkpoints/c", json={"action": "approve"}).status_code == 404
    assert client.post("/runs/run1/checkpoints/c", json={"action": "maybe"}).status_code == 422
    assert client.post("/runs/run1/checkpoints/c", json={"action": "edit", "edited_output": "new plan"}).json() == {"ok": True}
    assert fut.result()["edited_output"] == "new plan"
    assert client.post("/runs/run1/checkpoints/c", json={"action": "approve"}).status_code == 409
    loop.close()

def test_repeat_runs_are_capped_at_5(monkeypatch):
    started = []
    async def fake_start(body): started.append(body.session_id); return {"id": f"r{len(started)}"}
    async def no_judge(rid): return None
    monkeypatch.setattr(RT, "start_run", fake_start); monkeypatch.setattr(EV, "_judge_when_done", no_judge)
    r = client.post("/runs/repeat", json={"session_id": "s", "task_id": "t", "n": 50}).json()
    assert len(r["runs"]) == 5 and len(started) == 5

def test_compare_ranks_failed_runs_last_and_returns_breakdown(monkeypatch):
    rows = [
        {"id": "a", "session_id": "s1", "session_name": "Cheap+correct", "status": "done", "total_cost": 0.01, "total_latency_ms": 10_000,
         "total_input_tokens": 1, "total_output_tokens": 1, "final_judge_score": 9, "test_pass_rate": 1.0, "human_score": None, "interventions_count": 0},
        {"id": "b", "session_id": "s2", "session_name": "Cheap+wrong", "status": "done", "total_cost": 0.001, "total_latency_ms": 1_000,
         "total_input_tokens": 1, "total_output_tokens": 1, "final_judge_score": 1, "test_pass_rate": 0.0, "human_score": None, "interventions_count": 0},
        {"id": "c", "session_id": "s3", "session_name": "Not judged", "status": "done", "total_cost": 0.02, "total_latency_ms": 5_000,
         "total_input_tokens": 1, "total_output_tokens": 1, "final_judge_score": None, "test_pass_rate": None, "human_score": None, "interventions_count": 0},
    ]
    parts = [{"run_id": "a", "node_id": "e", "role": "executor", "node_kind": "llm", "model_or_tool": "m1", "calls": 2, "max_loop": 1,
              "input_tokens": 1, "output_tokens": 1, "cost_usd": 0.01, "latency_ms": 10, "reused": False}]
    use_db(monkeypatch, FakeDB([("from node_results", parts), ("from runs r", rows)]), EV)
    ranked = client.post("/compare", json={"task_id": "t"}).json()["ranked"]
    assert [r["session_name"] for r in ranked] == ["Cheap+correct", "Cheap+wrong", "Not judged"]
    assert ranked[1]["composite_score"] == 5.0          # wrong answer scores ~0 even though it is the cheapest and fastest
    assert ranked[2]["composite_score"] is None
    assert ranked[0]["models"] == ["m1"] and ranked[0]["llm_calls"] == 2 and ranked[0]["loops_used"] == 1

def test_validating_a_squad_with_a_dangling_arrow_returns_problems_not_500():
    g = {"nodes": [{"id": "a", "kind": "llm", "model": "m"}], "edges": [{"id": "x", "source": "a", "target": "deleted"}]}
    r = client.post("/graph/validate", json=g)
    assert r.status_code == 200 and r.json()["valid"] is False and "unknown source/target" in r.json()["problems"][0]

@pytest.mark.parametrize("path,count_sql", [("/tasks/t1", "from runs where task_id"), ("/sessions/s1", "from runs where session_id"),
                                             ("/skills/k1", "from sessions where graph")])
def test_delete_is_refused_when_something_depends_on_it(monkeypatch, path, count_sql):
    db = FakeDB([(count_sql, {"c": 2})]); use_db(monkeypatch, db)
    r = client.delete(path)
    assert r.status_code == 409 and not db.writes("delete from")

@pytest.mark.parametrize("path", ["/tasks/t1", "/sessions/s1", "/skills/k1"])
def test_delete_works_when_unused(monkeypatch, path):
    db = FakeDB([("count(*)", {"c": 0})]); use_db(monkeypatch, db)
    assert client.delete(path).json() == {"ok": True} and len(db.writes("delete from")) == 1

def test_cors_allows_configured_origin_only():
    ok = client.options("/models", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "GET"})
    bad = client.options("/models", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in bad.headers
