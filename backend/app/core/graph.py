"""Graph validation and ordering.

Graph JSON:
  nodes: [{id, kind: llm|tool|checkpoint, label, role, model|tool, system_prompt, skill_ids, params, ports:{in:[...], out:[...]}}]
  edges: [{id, source, target, type: text|audio, max_loops?}]
Edges with max_loops are "loop edges" (feedback). They are ignored for ordering and only
fire at runtime when the source node asks for a revision.
"""
from collections import defaultdict, deque

PORT_DEFAULTS = {
    "llm": {"in": ["text"], "out": ["text"]},
    "checkpoint": {"in": ["text"], "out": ["text"]},
    "elevenlabs.tts": {"in": ["text"], "out": ["audio"]},
    "elevenlabs.stt": {"in": ["audio"], "out": ["text"]},
}

def node_ports(node: dict) -> dict:
    if node.get("ports"):
        return node["ports"]
    if node.get("kind") == "tool":
        return PORT_DEFAULTS.get(node.get("tool", ""), {"in": ["text"], "out": ["text"]})
    return PORT_DEFAULTS.get(node.get("kind", "llm"), PORT_DEFAULTS["llm"])

def is_loop_edge(e: dict) -> bool:
    return bool(e.get("max_loops"))

class GraphError(ValueError):
    pass

def validate(graph: dict) -> list[str]:
    """Return a list of problems (empty = valid)."""
    problems = []
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    edges = graph.get("edges", [])
    if not nodes:
        return ["graph has no nodes"]
    for n in nodes.values():
        k = n.get("kind", "llm")
        if k == "llm" and not n.get("model"):
            problems.append(f"node {n['id']}: llm node needs a model")
        if k == "tool" and not n.get("tool"):
            problems.append(f"node {n['id']}: tool node needs a tool")
    for e in edges:
        s, t = nodes.get(e.get("source")), nodes.get(e.get("target"))
        if not s or not t:
            problems.append(f"edge {e.get('id')}: unknown source/target")
            continue
        etype = e.get("type", "text")
        if etype not in node_ports(s)["out"]:
            problems.append(f"edge {e.get('id')}: {s['id']} does not output {etype}")
        if etype not in node_ports(t)["in"]:
            problems.append(f"edge {e.get('id')}: {t['id']} does not accept {etype}")
    # forward edges must be acyclic
    try:
        topo_order(graph)
    except GraphError as ex:
        problems.append(str(ex))
    return problems

def forward_edges(graph: dict) -> list[dict]:
    return [e for e in graph.get("edges", []) if not is_loop_edge(e)]

def topo_order(graph: dict) -> list[str]:
    nodes = [n["id"] for n in graph["nodes"]]
    indeg = {n: 0 for n in nodes}
    out = defaultdict(list)
    for e in forward_edges(graph):
        if e.get("source") not in indeg or e.get("target") not in indeg:
            continue   # dangling edge (node was deleted): validate() reports it; ordering just ignores it
        out[e["source"]].append(e["target"])
        indeg[e["target"]] += 1
    dq = deque([n for n in nodes if indeg[n] == 0])
    order = []
    while dq:
        n = dq.popleft(); order.append(n)
        for m in out[n]:
            indeg[m] -= 1
            if indeg[m] == 0: dq.append(m)
    if len(order) != len(nodes):
        raise GraphError("cycle detected in forward edges (use max_loops on feedback edges)")
    return order

def predecessors(graph: dict, node_id: str) -> list[dict]:
    return [e for e in forward_edges(graph) if e["target"] == node_id]

def end_nodes(graph: dict) -> list[str]:
    has_out = {e["source"] for e in forward_edges(graph)}
    return [n["id"] for n in graph["nodes"] if n["id"] not in has_out]

def loop_edges_from(graph: dict, node_id: str) -> list[dict]:
    return [e for e in graph.get("edges", []) if is_loop_edge(e) and e["source"] == node_id]
