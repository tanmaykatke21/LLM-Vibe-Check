"""Executes a squad graph. Emits events via an async queue; persists via a Store interface
so tests can run without a database."""
import asyncio, time
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable
from app.core import graph as G
from app.core.prompts import build_prompt, APPROVE_TOKEN
from app.config import DEFAULT_MAX_LOOPS, RUN_COST_CAP_USD

class Store:
    """Persistence hooks. Default = in-memory (used by tests)."""
    def __init__(self):
        self.node_results: list[dict] = []
        self.messages: list[dict] = []
        self.checkpoints: dict[str, dict] = {}
    async def save_node_result(self, r: dict): self.node_results.append(r)
    async def save_message(self, m: dict): self.messages.append(m)
    async def save_checkpoint(self, c: dict): self.checkpoints[c["node_id"]] = c
    async def set_run_status(self, run_id: str, status: str, **fields): pass
    async def finish_run(self, run_id: str, totals: dict): pass

@dataclass
class RunContext:
    run_id: str
    graph: dict
    task: dict
    skills_by_id: dict[str, dict]
    store: Store
    provider_factory: Callable[[dict], Any]
    events: asyncio.Queue
    reused: dict[str, dict] = field(default_factory=dict)      # node_id -> prior result (forks)
    checkpoint_decisions: dict[str, asyncio.Future] = field(default_factory=dict)
    outputs: dict[str, dict] = field(default_factory=dict)      # node_id -> {content, kind}
    seq: int = 0
    totals: dict = field(default_factory=lambda: {"input_tokens": 0, "output_tokens": 0, "cost": 0.0, "human_wait_ms": 0})

    async def emit(self, type_: str, **data):
        await self.events.put({"type": type_, "run_id": self.run_id, **data})

def _label(graph: dict, nid: str) -> str:
    n = next(x for x in graph["nodes"] if x["id"] == nid)
    return n.get("label") or nid

def _role(graph: dict, nid: str) -> str:
    n = next(x for x in graph["nodes"] if x["id"] == nid)
    return n.get("role") or n.get("tool") or n.get("kind", "")

async def _record(ctx: RunContext, node: dict, res, loop_index: int, prompt: str, reused_from=None, status="done", error=None):
    row = {
        "run_id": ctx.run_id, "node_id": node["id"], "node_kind": node.get("kind", "llm"),
        "role": node.get("role"), "model_or_tool": getattr(res, "model_or_tool", node.get("model") or node.get("tool")),
        "loop_index": loop_index, "input": prompt, "output": getattr(res, "output", None),
        "output_kind": getattr(res, "output_kind", "text"),
        "audio_path": getattr(res, "output", None) if getattr(res, "output_kind", "text") == "audio" else None,
        "input_tokens": getattr(res, "input_tokens", 0), "output_tokens": getattr(res, "output_tokens", 0),
        "cached_tokens": getattr(res, "cached_tokens", 0), "units": getattr(res, "units", None),
        "cost_usd": 0.0 if reused_from else getattr(res, "cost_usd", 0.0),
        "latency_ms": getattr(res, "latency_ms", 0), "reused_from_run_id": reused_from,
        "status": status, "error": error,
    }
    await ctx.store.save_node_result(row)
    if not reused_from:
        ctx.totals["input_tokens"] += row["input_tokens"]
        ctx.totals["output_tokens"] += row["output_tokens"]
        ctx.totals["cost"] += row["cost_usd"]
    await ctx.emit("node_done", node_id=node["id"], loop_index=loop_index, result={k: row[k] for k in
                   ("output", "output_kind", "input_tokens", "output_tokens", "cost_usd", "latency_ms", "status", "model_or_tool")})
    return row

async def _send(ctx: RunContext, from_id: str, to_id: str, content: str, kind="text"):
    ctx.seq += 1
    m = {"run_id": ctx.run_id, "seq": ctx.seq, "from_node": from_id, "to_node": to_id, "kind": kind, "content": content}
    await ctx.store.save_message(m)
    await ctx.emit("message", **{k: m[k] for k in ("seq", "from_node", "to_node", "kind")})

async def _gather_inputs(ctx: RunContext, nid: str) -> list[dict]:
    inputs = []
    for e in G.predecessors(ctx.graph, nid):
        src = ctx.outputs.get(e["source"])
        if src is None:
            continue
        await _send(ctx, e["source"], nid, src["content"], src["kind"])
        inputs.append({"from_node": e["source"], "from_label": _label(ctx.graph, e["source"]),
                       "from_role": _role(ctx.graph, e["source"]), "content": src["content"], "kind": src["kind"]})
    return inputs

async def _run_checkpoint(ctx: RunContext, node: dict, inputs: list[dict]):
    incoming = "\n\n".join(i["content"] for i in inputs) if inputs else ctx.task["description"]
    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    ctx.checkpoint_decisions[node["id"]] = fut
    await ctx.store.save_checkpoint({"run_id": ctx.run_id, "node_id": node["id"], "status": "waiting", "original_output": incoming})
    await ctx.store.set_run_status(ctx.run_id, "paused")
    await ctx.emit("checkpoint_waiting", node_id=node["id"], output=incoming)
    t0 = time.perf_counter()
    timeout = (node.get("params") or {}).get("timeout_minutes", 30) * 60
    try:
        decision = await asyncio.wait_for(fut, timeout=timeout)
    except asyncio.TimeoutError:
        decision = {"action": (node.get("params") or {}).get("on_timeout", "approve")}
    wait_ms = int((time.perf_counter() - t0) * 1000)
    ctx.totals["human_wait_ms"] += wait_ms
    await ctx.store.set_run_status(ctx.run_id, "running")
    action = decision.get("action", "approve")
    out = decision.get("edited_output") if action == "edit" else incoming
    await ctx.store.save_checkpoint({"run_id": ctx.run_id, "node_id": node["id"], "status": {"approve": "approved", "edit": "edited", "reject": "rejected"}.get(action, action),
                                     "original_output": incoming, "edited_output": decision.get("edited_output"),
                                     "reviewer_note": decision.get("note"), "wait_ms": wait_ms})
    await ctx.emit("checkpoint_decided", node_id=node["id"], action=action, wait_ms=wait_ms)

    class R:  # minimal result object
        output = out; output_kind = "text"; input_tokens = output_tokens = cached_tokens = 0
        units = None; cost_usd = 0.0; latency_ms = 0; model_or_tool = "human"
    await _record(ctx, node, R, 0, incoming)
    if action == "reject":
        raise RuntimeError(f"Checkpoint {node['id']} rejected: {decision.get('note','')}")
    return out

async def _run_node(ctx: RunContext, nid: str, loop_index: int = 0, loop_note: str | None = None):
    node = next(n for n in ctx.graph["nodes"] if n["id"] == nid)
    inputs = await _gather_inputs(ctx, nid)
    await ctx.emit("node_start", node_id=nid, loop_index=loop_index)

    if nid in ctx.reused and loop_index == 0:
        prior = ctx.reused[nid]
        class R:
            output = prior["output"]; output_kind = prior.get("output_kind", "text")
            input_tokens = prior.get("input_tokens", 0); output_tokens = prior.get("output_tokens", 0)
            cached_tokens = prior.get("cached_tokens", 0); units = prior.get("units")
            cost_usd = prior.get("cost_usd", 0.0); latency_ms = prior.get("latency_ms", 0)
            model_or_tool = prior.get("model_or_tool", "")
        await _record(ctx, node, R, 0, prior.get("input") or "", reused_from=prior["run_id"])
        ctx.outputs[nid] = {"content": R.output, "kind": R.output_kind}
        return

    if node.get("kind") == "checkpoint":
        out = await _run_checkpoint(ctx, node, inputs)
        ctx.outputs[nid] = {"content": out, "kind": "text"}
        return

    skills = [ctx.skills_by_id[s] for s in node.get("skill_ids", []) if s in ctx.skills_by_id]
    if node.get("kind") == "tool":
        prompt = "\n\n".join(i["content"] for i in inputs if i["kind"] == "text") or ctx.task["description"]
    else:
        prompt = build_prompt(node, ctx.task, inputs, skills, loop_note)

    if ctx.totals["cost"] > RUN_COST_CAP_USD:
        raise RuntimeError(f"Run cost cap ${RUN_COST_CAP_USD} exceeded")

    provider = ctx.provider_factory(node)
    try:
        res = await provider.run(node, prompt, inputs)
    except Exception as ex:
        msg = str(ex)
        resp = getattr(ex, "response", None)
        if resp is not None:
            code = getattr(resp, "status_code", "")
            hint = {402: "out of OpenRouter credits", 401: "invalid API key", 404: "model id not found", 429: "rate limited"}.get(code, "")
            try: detail = resp.json().get("error", {}).get("message", "")
            except Exception: detail = ""
            msg = f"provider error {code}: {hint} {detail}".strip()
        class R:
            output = ""; output_kind = "text"; input_tokens = output_tokens = cached_tokens = 0
            units = None; cost_usd = 0.0; latency_ms = 0; model_or_tool = node.get("model") or node.get("tool", "")
        await _record(ctx, node, R, loop_index, prompt, status="error", error=msg[:500])
        raise RuntimeError(f"{node['id']}: {msg}") from ex
    await _record(ctx, node, res, loop_index, prompt)
    ctx.outputs[nid] = {"content": res.output, "kind": res.output_kind}

    # Feedback loop: if this node has a loop edge and did NOT approve, send back upstream
    for le in G.loop_edges_from(ctx.graph, nid):
        approved = res.output_kind == "text" and res.output.strip().upper().startswith(APPROVE_TOKEN)
        max_loops = int(le.get("max_loops") or DEFAULT_MAX_LOOPS)
        if not approved and loop_index < max_loops:
            target = le["target"]
            await _send(ctx, nid, target, res.output, "text")
            await ctx.emit("loop", from_node=nid, to_node=target, loop_index=loop_index + 1)
            await _run_node(ctx, target, loop_index + 1, loop_note=f"Feedback from {_label(ctx.graph, nid)}:\n{res.output}")
            # re-run self on the revised output (same loop index + 1)
            await _run_node(ctx, nid, loop_index + 1)
            return

async def execute(ctx: RunContext) -> dict:
    """Run the whole graph. Returns totals + final output."""
    t0 = time.perf_counter()
    await ctx.store.set_run_status(ctx.run_id, "running")
    await ctx.emit("run_start")
    order = G.topo_order(ctx.graph)
    done: set[str] = set()
    pending = set(order)
    try:
        while pending:
            ready = [n for n in pending if all(e["source"] in done for e in G.predecessors(ctx.graph, n))]
            if not ready:
                raise RuntimeError("no runnable nodes (bad graph)")
            await asyncio.gather(*(_run_node(ctx, n) for n in ready))
            done.update(ready); pending.difference_update(ready)
        ends = G.end_nodes(ctx.graph)
        finals = [ctx.outputs[e]["content"] for e in ends if e in ctx.outputs]
        final = "\n\n---\n\n".join(finals)
        totals = {**ctx.totals, "latency_ms": int((time.perf_counter() - t0) * 1000), "final_output": final, "status": "done"}
        await ctx.store.finish_run(ctx.run_id, totals)
        await ctx.emit("run_done", totals={k: totals[k] for k in ("input_tokens", "output_tokens", "cost", "latency_ms", "human_wait_ms")})
        return totals
    except Exception as ex:
        totals = {**ctx.totals, "latency_ms": int((time.perf_counter() - t0) * 1000), "final_output": None, "status": "failed", "error": str(ex)[:500]}
        await ctx.store.finish_run(ctx.run_id, totals)
        await ctx.emit("run_failed", error=str(ex)[:500])
        return totals
