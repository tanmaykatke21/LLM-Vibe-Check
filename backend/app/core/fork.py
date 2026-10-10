"""Fork a run from a node: reuse upstream results, re-run from the fork node with changes."""
import json, copy
from app.db.client import q, one
from app.core import graph as G
from app.core import run_manager as RM

def _upstream(graph: dict, node_id: str) -> set[str]:
    """All nodes that must run before node_id (transitive predecessors)."""
    seen, stack = set(), [node_id]
    while stack:
        n = stack.pop()
        for e in G.predecessors(graph, n):
            if e["source"] not in seen:
                seen.add(e["source"]); stack.append(e["source"])
    return seen

async def create_fork(parent_run_id: str, from_node_id: str, node_changes: dict) -> dict:
    parent = one("select * from runs where id=%s", (parent_run_id,))
    if not parent: raise ValueError("parent run not found")
    graph = copy.deepcopy(parent["graph_snapshot"])
    ids = {n["id"] for n in graph["nodes"]}
    if from_node_id not in ids: raise ValueError("from_node_id not in graph")
    for nid, ch in node_changes.items():
        for n in graph["nodes"]:
            if n["id"] == nid: n.update(ch)
    probs = G.validate(graph)
    if probs: raise ValueError("; ".join(probs))
    task = one("select * from tasks where id=%s", (parent["task_id"],))
    # upstream results to reuse (latest attempt per node)
    up = _upstream(graph, from_node_id)
    reused = {}
    for r in q("select * from node_results where run_id=%s and status='done' order by ts", (parent_run_id,)):
        if r["node_id"] in up:
            reused[r["node_id"]] = {**r, "run_id": str(parent_run_id), "cost_usd": float(r["cost_usd"])}
    run = one("""insert into runs (session_id,task_id,parent_run_id,forked_from_node,graph_snapshot,status)
                 values (%s,%s,%s,%s,%s,'queued') returning *""",
              (parent["session_id"], parent["task_id"], parent_run_id, from_node_id, json.dumps(graph)))
    await RM.start_run(str(run["id"]), graph, {**task, "id": str(task["id"])}, reused=reused)
    return {**run, "reused_nodes": sorted(up), "changed_nodes": list(node_changes.keys())}

def fork_tree(run_id: str) -> dict:
    """Walk up to the root, then return the whole tree under it."""
    cur = one("select id, parent_run_id from runs where id=%s", (run_id,))
    while cur and cur["parent_run_id"]:
        cur = one("select id, parent_run_id from runs where id=%s", (cur["parent_run_id"],))
    root_id = cur["id"]
    rows = q("""with recursive t as (
                 select r.*, 0 depth from runs r where id=%s
                 union all select r.*, t.depth+1 from runs r join t on r.parent_run_id=t.id)
               select t.id, t.parent_run_id, t.forked_from_node, t.status, t.total_cost, t.total_latency_ms, t.depth, t.created_at,
                      e.composite_score, e.completion_status
               from t left join evaluations e on e.run_id=t.id order by depth, created_at""", (root_id,))
    return {"root": root_id, "runs": rows}
