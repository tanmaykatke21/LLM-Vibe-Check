import asyncio, pytest
from app.core.runner import RunContext, Store, execute
from tests.conftest import FakeProvider

def make_ctx(graph, task, factory, **kw):
    return RunContext(run_id="r1", graph=graph, task=task, skills_by_id={}, store=Store(),
                      provider_factory=factory, events=asyncio.Queue(), **kw)

def drain(q):
    out = []
    while not q.empty(): out.append(q.get_nowait())
    return out

@pytest.mark.asyncio
async def test_linear_run_produces_final_output_and_metrics(linear_graph, task, fake_factory):
    ctx = make_ctx(linear_graph, task, fake_factory)
    totals = await execute(ctx)
    assert totals["status"] == "done"
    assert "APPROVED" in totals["final_output"] or "Fix" in totals["final_output"]
    assert len(ctx.store.node_results) == 3
    assert totals["input_tokens"] == 300 and totals["output_tokens"] == 150
    assert abs(totals["cost"] - 0.003) < 1e-9
    # messages recorded p->e and e->r
    assert [(m["from_node"], m["to_node"]) for m in ctx.store.messages] == [("p", "e"), ("e", "r")]
    types = [e["type"] for e in drain(ctx.events)]
    assert types[0] == "run_start" and types[-1] == "run_done"

@pytest.mark.asyncio
async def test_executor_receives_planner_output(linear_graph, task, fake_factory):
    ctx = make_ctx(linear_graph, task, fake_factory)
    await execute(ctx)
    exec_prompt = next(p for nid, p in FakeProvider.calls if nid == "e")
    assert "planner output v1" in exec_prompt
    assert "Write a function that parses dates" in exec_prompt

@pytest.mark.asyncio
async def test_loop_edge_sends_back_then_approves(linear_graph, task, fake_factory):
    linear_graph["edges"].append({"id": "back", "source": "r", "target": "e", "type": "text", "max_loops": 2})
    ctx = make_ctx(linear_graph, task, fake_factory)
    totals = await execute(ctx)
    assert totals["status"] == "done"
    ids = [nid for nid, _ in FakeProvider.calls]
    # p, e, r(fix), e(revised), r(approved)
    assert ids == ["p", "e", "r", "e", "r"]
    revised_prompt = FakeProvider.calls[3][1]
    assert "Revision requested" in revised_prompt and "add input validation" in revised_prompt
    # final output is the executor's revised work, not the reviewer's "APPROVED" verdict
    assert not totals["final_output"].startswith("APPROVED")
    assert totals["final_output"] == ctx.outputs["e"]["content"]

@pytest.mark.asyncio
async def test_parallel_branches_run_together(task, fake_factory):
    g = {"nodes": [
        {"id": "p", "kind": "llm", "role": "planner", "model": "m"},
        {"id": "a", "kind": "llm", "role": "writer_a", "model": "m"},
        {"id": "b", "kind": "llm", "role": "writer_b", "model": "m"},
        {"id": "m", "kind": "llm", "role": "merger", "model": "m"},
    ], "edges": [{"id":"1","source":"p","target":"a"},{"id":"2","source":"p","target":"b"},
                 {"id":"3","source":"a","target":"m"},{"id":"4","source":"b","target":"m"}]}
    ctx = make_ctx(g, task, fake_factory)
    totals = await execute(ctx)
    assert totals["status"] == "done"
    merge_prompt = next(p for nid, p in FakeProvider.calls if nid == "m")
    assert "writer_a output" in merge_prompt and "writer_b output" in merge_prompt

@pytest.mark.asyncio
async def test_checkpoint_pauses_and_resumes_with_edit(task, fake_factory):
    g = {"nodes": [
        {"id": "p", "kind": "llm", "role": "planner", "model": "m"},
        {"id": "c", "kind": "checkpoint", "label": "Approve plan"},
        {"id": "e", "kind": "llm", "role": "executor", "model": "m"},
    ], "edges": [{"id":"1","source":"p","target":"c"},{"id":"2","source":"c","target":"e"}]}
    ctx = make_ctx(g, task, fake_factory)
    run = asyncio.create_task(execute(ctx))
    # wait for checkpoint_waiting event
    while True:
        ev = await ctx.events.get()
        if ev["type"] == "checkpoint_waiting":
            break
    assert "c" in ctx.checkpoint_decisions
    ctx.checkpoint_decisions["c"].set_result({"action": "edit", "edited_output": "HUMAN EDITED PLAN", "note": "tightened"})
    totals = await run
    assert totals["status"] == "done"
    exec_prompt = next(p for nid, p in FakeProvider.calls if nid == "e")
    assert "HUMAN EDITED PLAN" in exec_prompt
    cp = ctx.store.checkpoints["c"]
    assert cp["status"] == "edited" and cp["wait_ms"] >= 0

@pytest.mark.asyncio
async def test_checkpoint_reject_fails_run(task, fake_factory):
    g = {"nodes": [{"id": "p", "kind": "llm", "role": "planner", "model": "m"},
                   {"id": "c", "kind": "checkpoint"}],
         "edges": [{"id":"1","source":"p","target":"c"}]}
    ctx = make_ctx(g, task, fake_factory)
    run = asyncio.create_task(execute(ctx))
    while (await ctx.events.get())["type"] != "checkpoint_waiting": pass
    ctx.checkpoint_decisions["c"].set_result({"action": "reject", "note": "wrong direction"})
    totals = await run
    assert totals["status"] == "failed" and "rejected" in totals["error"]

@pytest.mark.asyncio
async def test_fork_reuses_upstream_at_zero_cost(linear_graph, task, fake_factory):
    reused = {"p": {"run_id": "parent", "output": "REUSED PLAN", "input_tokens": 999, "output_tokens": 999, "cost_usd": 0.5}}
    ctx = make_ctx(linear_graph, task, fake_factory, reused=reused)
    totals = await execute(ctx)
    assert totals["status"] == "done"
    assert [nid for nid, _ in FakeProvider.calls] == ["e", "r"]      # planner not re-run
    p_row = next(r for r in ctx.store.node_results if r["node_id"] == "p")
    assert p_row["reused_from_run_id"] == "parent" and p_row["cost_usd"] == 0.0
    assert totals["cost"] == pytest.approx(0.002)                    # only e + r charged
    exec_prompt = next(p for nid, p in FakeProvider.calls if nid == "e")
    assert "REUSED PLAN" in exec_prompt

@pytest.mark.asyncio
async def test_provider_error_marks_run_failed(linear_graph, task):
    class Boom:
        def __init__(self, n): pass
        async def run(self, node, prompt, inputs): raise RuntimeError("API down")
    ctx = make_ctx(linear_graph, task, lambda n: Boom(n))
    totals = await execute(ctx)
    assert totals["status"] == "failed" and "API down" in totals["error"]
    assert ctx.store.node_results[0]["status"] == "error"
