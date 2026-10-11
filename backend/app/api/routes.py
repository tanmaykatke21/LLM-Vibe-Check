import json, asyncio
from fastapi import APIRouter, HTTPException
from sse_starlette.sse import EventSourceResponse
from app.db.client import q, one
from app.schemas import *
from app.core import graph as G
from app.core import run_manager as RM
from app.providers.pricing import known_models, refresh_from_openrouter
from app.providers import TOOL_PROVIDERS

r = APIRouter()

def _j(x):  # jsonb in
    return json.dumps(x)

# ---------- models ----------
@r.get("/models")
async def models():
    return {"llms": known_models(), "tools": list(TOOL_PROVIDERS.keys())}

@r.post("/models/refresh")
async def models_refresh():
    return {"loaded": await refresh_from_openrouter()}

# ---------- skills ----------
@r.get("/skills")
def list_skills(): return q("select * from skills where user_id=%s order by created_at desc", (LOCAL_USER,))
@r.post("/skills")
def create_skill(s: SkillIn):
    return one("insert into skills (user_id,name,description,instructions) values (%s,%s,%s,%s) returning *",
               (LOCAL_USER, s.name, s.description, s.instructions))
@r.put("/skills/{sid}")
def update_skill(sid: str, s: SkillIn):
    row = one("update skills set name=%s, description=%s, instructions=%s where id=%s returning *", (s.name, s.description, s.instructions, sid))
    if not row: raise HTTPException(404)
    return row
@r.delete("/skills/{sid}")
def delete_skill(sid: str):
    used = one("select count(*) c from sessions where graph::text like %s", (f"%{sid}%",))["c"]
    if used: raise HTTPException(409, f"This skill is attached to {used} squad(s). Remove it from those nodes first.")
    q("delete from skills where id=%s", (sid,)); return {"ok": True}

# ---------- tasks ----------
@r.get("/tasks")
def list_tasks(): return q("select * from tasks where user_id=%s order by created_at desc", (LOCAL_USER,))
@r.post("/tasks")
def create_task(t: TaskIn):
    return one("insert into tasks (user_id,title,description,task_type,test_cases,rubric,reference_output) values (%s,%s,%s,%s,%s,%s,%s) returning *",
               (LOCAL_USER, t.title, t.description, t.task_type, _j(t.test_cases) if t.test_cases is not None else None,
                _j(t.rubric) if t.rubric is not None else None, t.reference_output))
@r.delete("/tasks/{tid}")
def delete_task(tid: str):
    n = one("select count(*) c from runs where task_id=%s", (tid,))["c"]
    if n: raise HTTPException(409, f"This task has {n} run(s). It is kept so their results stay comparable.")
    q("delete from tasks where id=%s", (tid,)); return {"ok": True}
@r.get("/tasks/{tid}")
def get_task(tid: str):
    row = one("select * from tasks where id=%s", (tid,))
    if not row: raise HTTPException(404)
    return row

# ---------- sessions ----------
@r.get("/sessions")
def list_sessions(): return q("select id,name,graph,created_at,updated_at from sessions where user_id=%s order by updated_at desc", (LOCAL_USER,))
@r.post("/sessions")
def create_session(s: SessionIn):
    return one("insert into sessions (user_id,name,graph) values (%s,%s,%s) returning *", (LOCAL_USER, s.name, _j(s.graph)))
@r.get("/sessions/{sid}")
def get_session(sid: str):
    row = one("select * from sessions where id=%s", (sid,))
    if not row: raise HTTPException(404)
    return row
@r.put("/sessions/{sid}")
def update_session(sid: str, s: SessionIn):
    row = one("update sessions set name=%s, graph=%s, updated_at=now() where id=%s returning *", (s.name, _j(s.graph), sid))
    if not row: raise HTTPException(404)
    return row
@r.delete("/sessions/{sid}")
def delete_session(sid: str):
    n = one("select count(*) c from runs where session_id=%s", (sid,))["c"]
    if n: raise HTTPException(409, f"This squad has {n} run(s). It is kept so their results stay comparable.")
    q("delete from sessions where id=%s", (sid,)); return {"ok": True}
@r.post("/sessions/{sid}/validate")
def validate_session(sid: str):
    row = one("select graph from sessions where id=%s", (sid,))
    if not row: raise HTTPException(404)
    probs = G.validate(row["graph"])
    return {"valid": not probs, "problems": probs}
@r.post("/graph/validate")
def validate_graph(body: dict):
    probs = G.validate(body)
    return {"valid": not probs, "problems": probs}

# ---------- runs ----------
@r.post("/runs")
async def start_run(body: RunIn):
    s = one("select * from sessions where id=%s", (body.session_id,))
    t = one("select * from tasks where id=%s", (body.task_id,))
    if not s or not t: raise HTTPException(404, "session or task not found")
    probs = G.validate(s["graph"])
    if probs: raise HTTPException(400, {"problems": probs})
    run = one("insert into runs (session_id,task_id,graph_snapshot,status) values (%s,%s,%s,'queued') returning *",
              (body.session_id, body.task_id, _j(s["graph"])))
    await RM.start_run(str(run["id"]), s["graph"], {**t, "id": str(t["id"])})
    return run

@r.get("/runs")
def list_runs(task_id: str | None = None, session_id: str | None = None):
    sql = "select r.*, s.name as session_name, t.title as task_title from runs r join sessions s on s.id=r.session_id join tasks t on t.id=r.task_id where 1=1"
    params = []
    if task_id: sql += " and r.task_id=%s"; params.append(task_id)
    if session_id: sql += " and r.session_id=%s"; params.append(session_id)
    return q(sql + " order by r.created_at desc", params)

@r.get("/runs/{rid}")
def get_run(rid: str):
    row = one("select r.*, s.name as session_name, t.title as task_title from runs r join sessions s on s.id=r.session_id join tasks t on t.id=r.task_id where r.id=%s", (rid,))
    if not row: raise HTTPException(404)
    return row

@r.get("/runs/{rid}/messages")
def run_messages(rid: str): return q("select * from messages where run_id=%s order by seq", (rid,))

@r.get("/runs/{rid}/nodes")
def run_nodes(rid: str): return q("select * from node_results where run_id=%s order by ts", (rid,))

@r.get("/runs/{rid}/metrics")
def run_metrics(rid: str):
    run = one("select * from runs where id=%s", (rid,))
    if not run: raise HTTPException(404)
    nodes = q("""select node_id, max(role) role, max(node_kind) node_kind, max(model_or_tool) model_or_tool,
                 count(*) calls, sum(input_tokens) input_tokens, sum(output_tokens) output_tokens, sum(cached_tokens) cached_tokens,
                 sum(units) units, sum(cost_usd) cost_usd, sum(latency_ms) latency_ms, bool_or(reused_from_run_id is not null) reused
                 from node_results where run_id=%s group by node_id order by min(ts)""", (rid,))
    total_cost = float(run["total_cost"] or 0)
    total_lat = sum(int(n["latency_ms"]) for n in nodes) or 1
    for n in nodes:
        n["cost_share"] = round(float(n["cost_usd"]) / total_cost, 3) if total_cost else 0
        n["time_share"] = round(int(n["latency_ms"]) / total_lat, 3)
    judge_cost = one("select coalesce(sum(judge_cost_usd),0) c from judge_results where run_id=%s", (rid,))["c"]
    return {"run_id": rid, "status": run["status"], "nodes": nodes,
            "totals": {"input_tokens": run["total_input_tokens"], "output_tokens": run["total_output_tokens"],
                       "cost_usd": total_cost, "wall_clock_ms": run["total_latency_ms"], "human_wait_ms": run["human_wait_ms"],
                       "sum_node_latency_ms": total_lat, "judge_cost_usd": float(judge_cost)},
            "projection": {"per_1k_runs_usd": round(total_cost * 1000, 2)}}

@r.get("/runs/{rid}/stream")
async def run_stream(rid: str):
    async def gen():
        # replay what already happened for late joiners
        for n in q("select node_id, loop_index, output, output_kind, input_tokens, output_tokens, cost_usd, latency_ms, status, model_or_tool from node_results where run_id=%s order by ts", (rid,)):
            yield {"event": "node_done", "data": json.dumps({"type": "node_done", "run_id": rid, "node_id": n["node_id"], "loop_index": n["loop_index"],
                   "result": {k: (float(v) if k == "cost_usd" else v) for k, v in n.items() if k not in ("node_id", "loop_index")}}, default=str)}
        ctx = RM.get_ctx(rid)
        if ctx is None:
            run = one("select status, error from runs where id=%s", (rid,))
            yield {"event": run["status"], "data": json.dumps({"type": "run_" + ("done" if run["status"] == "done" else "failed"), "error": run.get("error")})}
            return
        for nid, fut in ctx.checkpoint_decisions.items():
            if not fut.done():
                yield {"event": "checkpoint_waiting", "data": json.dumps({"type": "checkpoint_waiting", "node_id": nid})}
        sub = RM.subscribe(rid)
        while True:
            ev = await sub.get()
            if ev["type"] == "end": return
            yield {"event": ev["type"], "data": json.dumps(ev, default=str)}
    return EventSourceResponse(gen())

# ---------- checkpoints ----------
@r.get("/runs/{rid}/checkpoints")
def run_checkpoints(rid: str): return q("select * from checkpoints where run_id=%s order by created_at", (rid,))

@r.post("/runs/{rid}/checkpoints/{node_id}")
def decide_checkpoint(rid: str, node_id: str, d: CheckpointDecision):
    ctx = RM.get_ctx(rid)
    if not ctx or node_id not in ctx.checkpoint_decisions: raise HTTPException(404, "no waiting checkpoint")
    fut = ctx.checkpoint_decisions[node_id]
    if fut.done(): raise HTTPException(409, "already decided")
    fut.set_result(d.model_dump())
    return {"ok": True}
