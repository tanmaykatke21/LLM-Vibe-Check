"""Run engine edge cases (app/core/runner.py): loops that never approve, cost cap, timeouts, tools, multiple outputs."""
import asyncio
from app.core import runner as R
from app.core.runner import RunContext, Store, execute
from app.providers.base import NodeResult

class Scripted:
    """Provider whose replies are scripted per node id; records every prompt it receives."""
    def __init__(self, replies: dict[str, list[str]], cost=0.001):
        self.replies, self.cost, self.calls = {k: list(v) for k, v in replies.items()}, cost, []
    def factory(self, node):
        outer = self
        class P:
            async def run(self, node, prompt, inputs):
                outer.calls.append((node["id"], prompt))
                seq = outer.replies.get(node["id"], [f"{node['id']} output"])
                out = seq.pop(0) if len(seq) > 1 else seq[0]
                return NodeResult(output=out, input_tokens=10, output_tokens=5, cost_usd=outer.cost, latency_ms=1,
                                  model_or_tool=node.get("model") or node.get("tool", ""))
        return P()

def ctx_for(graph, provider, task=None):
    return RunContext(run_id="r1", graph=graph, task=task or {"id": "t", "description": "Do it"}, skills_by_id={},
                      store=Store(), provider_factory=provider.factory, events=asyncio.Queue())

def loop_graph(max_loops=2):
    return {"nodes": [{"id": "p", "kind": "llm", "role": "planner", "model": "m"},
                      {"id": "e", "kind": "llm", "role": "executor", "model": "m"},
                      {"id": "r", "kind": "llm", "role": "reviewer", "model": "m"}],
            "edges": [{"id": "1", "source": "p", "target": "e"}, {"id": "2", "source": "e", "target": "r"},
                      {"id": "b", "source": "r", "target": "e", "max_loops": max_loops}]}

async def test_reviewer_that_never_approves_stops_at_max_loops():
    prov = Scripted({"e": ["code v1", "code v2", "code v3"], "r": ["Fix it"]})
    totals = await execute(ctx_for(loop_graph(2), prov))
    assert totals["status"] == "done"
    assert [c[0] for c in prov.calls] == ["p", "e", "r", "e", "r", "e", "r"]   # 2 revisions, then stop
    assert totals["final_output"] == "code v3"                                 # the executor's latest work, not "Fix it"

async def test_approved_on_first_review_means_no_loop():
    prov = Scripted({"e": ["code v1"], "r": ["APPROVED looks good"]})
    totals = await execute(ctx_for(loop_graph(2), prov))
    assert [c[0] for c in prov.calls] == ["p", "e", "r"] and totals["final_output"] == "code v1"

async def test_approval_is_case_insensitive_and_ignores_leading_whitespace():
    prov = Scripted({"r": ["  approved\nnotes"]})
    await execute(ctx_for(loop_graph(2), prov))
    assert [c[0] for c in prov.calls] == ["p", "e", "r"]

async def test_cost_cap_stops_the_run(monkeypatch):
    monkeypatch.setattr(R, "RUN_COST_CAP_USD", 0.0015)        # p + e spend 0.002 > cap, so r must not run
    prov = Scripted({})
    totals = await execute(ctx_for(loop_graph(2), prov))
    assert totals["status"] == "failed" and "cost cap" in totals["error"]
    assert [c[0] for c in prov.calls] == ["p", "e"]

async def test_multiple_end_nodes_are_joined():
    g = {"nodes": [{"id": "a", "kind": "llm", "model": "m"}, {"id": "b", "kind": "llm", "model": "m"}], "edges": []}
    totals = await execute(ctx_for(g, Scripted({"a": ["A"], "b": ["B"]})))
    assert set(totals["final_output"].split("\n\n---\n\n")) == {"A", "B"}

async def test_tool_node_gets_plain_upstream_text_not_a_prompt():
    g = {"nodes": [{"id": "w", "kind": "llm", "role": "writer", "model": "m"}, {"id": "tts", "kind": "tool", "tool": "elevenlabs.tts"}],
         "edges": [{"id": "1", "source": "w", "target": "tts"}]}
    prov = Scripted({"w": ["Hello listeners"]})
    await execute(ctx_for(g, prov))
    assert prov.calls[1] == ("tts", "Hello listeners")

async def test_messages_are_numbered_in_order():
    ctx = ctx_for(loop_graph(2), Scripted({"r": ["Fix", "APPROVED"]}))
    await execute(ctx)
    seqs = [m["seq"] for m in ctx.store.messages]
    assert seqs == list(range(1, len(seqs) + 1))
    assert ("r", "e") in [(m["from_node"], m["to_node"]) for m in ctx.store.messages]   # feedback message recorded

async def test_checkpoint_timeout_auto_approves():
    g = {"nodes": [{"id": "p", "kind": "llm", "model": "m"},
                   {"id": "c", "kind": "checkpoint", "params": {"timeout_minutes": 0.001, "on_timeout": "approve"}},
                   {"id": "e", "kind": "llm", "model": "m"}],
         "edges": [{"id": "1", "source": "p", "target": "c"}, {"id": "2", "source": "c", "target": "e"}]}
    prov = Scripted({"p": ["the plan"]})
    ctx = ctx_for(g, prov)
    totals = await execute(ctx)
    assert totals["status"] == "done" and ctx.store.checkpoints["c"]["status"] == "approved"
    assert "the plan" in prov.calls[-1][1]                    # executor received the un-edited plan
    assert totals["human_wait_ms"] >= 50

async def test_checkpoint_timeout_can_reject():
    g = {"nodes": [{"id": "p", "kind": "llm", "model": "m"},
                   {"id": "c", "kind": "checkpoint", "params": {"timeout_minutes": 0.001, "on_timeout": "reject"}}],
         "edges": [{"id": "1", "source": "p", "target": "c"}]}
    totals = await execute(ctx_for(g, Scripted({})))
    assert totals["status"] == "failed" and "rejected" in totals["error"]

async def test_reused_node_is_rerun_when_feedback_loops_back_to_it():
    prov = Scripted({"e": ["fresh code"], "r": ["Fix", "APPROVED"]})
    ctx = ctx_for(loop_graph(2), prov)
    ctx.reused = {n: {"run_id": "parent", "output": f"old {n}", "cost_usd": 0.5} for n in ("p", "e")}
    totals = await execute(ctx)
    assert [c[0] for c in prov.calls] == ["r", "e", "r"]       # p and first e reused; e re-run for the revision
    assert totals["final_output"] == "fresh code"
    assert abs(totals["cost"] - 0.003) < 1e-9                 # reused nodes cost $0 (not 0.5 each)

async def test_events_cover_the_whole_run():
    ctx = ctx_for(loop_graph(2), Scripted({"r": ["Fix", "APPROVED"]}))
    await execute(ctx)
    types = []
    while not ctx.events.empty(): types.append(ctx.events.get_nowait()["type"])
    assert types[0] == "run_start" and types[-1] == "run_done"
    assert types.count("node_start") == 5 and types.count("node_done") == 5 and types.count("loop") == 1
