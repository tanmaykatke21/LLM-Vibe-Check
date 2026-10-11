"""Live event fan-out used by the run page's live view (app/core/run_manager.py)."""
import asyncio
from app.core import run_manager as RM

async def test_subscribers_get_every_event_then_end_and_run_is_released():
    events = asyncio.Queue()
    RM._live["run-x"] = object()
    sub = RM.subscribe("run-x")
    task = asyncio.create_task(RM._fanout("run-x", events))
    for ev in ({"type": "node_done"}, {"type": "run_done"}):
        await events.put(ev)
    got = [await asyncio.wait_for(sub.get(), 3) for _ in range(3)]
    await task
    assert [g["type"] for g in got] == ["node_done", "run_done", "end"]
    assert "run-x" not in RM._live and "run-x" not in RM._subscribers
