"""Keeps live RunContexts in memory so SSE and checkpoint endpoints can reach them."""
import asyncio, json
from app.core.runner import RunContext, execute
from app.core.store_db import DbStore
from app.providers import provider_for
from app.db.client import q, one

_live: dict[str, RunContext] = {}
_subscribers: dict[str, list[asyncio.Queue]] = {}

def get_ctx(run_id: str) -> RunContext | None:
    return _live.get(run_id)

async def _fanout(run_id: str, events: asyncio.Queue):
    while True:
        ev = await events.get()
        for sub in list(_subscribers.get(run_id, [])):
            await sub.put(ev)
        if ev["type"] in ("run_done", "run_failed"):
            await asyncio.sleep(1)
            _live.pop(run_id, None)
            for sub in list(_subscribers.get(run_id, [])):
                await sub.put({"type": "end"})
            _subscribers.pop(run_id, None)
            return

def subscribe(run_id: str) -> asyncio.Queue:
    qq: asyncio.Queue = asyncio.Queue()
    _subscribers.setdefault(run_id, []).append(qq)
    return qq

def _load_skills(graph: dict) -> dict:
    ids = {s for n in graph["nodes"] for s in n.get("skill_ids", [])}
    if not ids: return {}
    rows = q("select * from skills where id = any(%s)", ([str(i) for i in ids],))
    return {str(r["id"]): r for r in rows}

async def start_run(run_id: str, graph: dict, task: dict, reused: dict | None = None):
    ctx = RunContext(run_id=run_id, graph=graph, task=task, skills_by_id=_load_skills(graph),
                     store=DbStore(), provider_factory=provider_for, events=asyncio.Queue(), reused=reused or {})
    _live[run_id] = ctx
    asyncio.create_task(_fanout(run_id, ctx.events))
    asyncio.create_task(execute(ctx))
    return ctx
