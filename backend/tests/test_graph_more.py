"""Graph rules beyond the basics (app/core/graph.py)."""
import pytest
from app.core import graph as G

def test_empty_graph_is_invalid():
    assert G.validate({"nodes": [], "edges": []}) == ["graph has no nodes"]

def test_edge_to_unknown_node_is_reported():
    g = {"nodes": [{"id": "a", "kind": "llm", "model": "m"}], "edges": [{"id": "x", "source": "a", "target": "ghost"}]}
    assert any("unknown source/target" in p for p in G.validate(g))

def test_tool_node_without_tool_is_reported():
    assert any("needs a tool" in p for p in G.validate({"nodes": [{"id": "t", "kind": "tool"}], "edges": []}))

def test_custom_ports_override_defaults():
    g = {"nodes": [{"id": "a", "kind": "llm", "model": "m", "ports": {"in": ["text"], "out": ["audio"]}},
                   {"id": "s", "kind": "tool", "tool": "elevenlabs.stt"}],
         "edges": [{"id": "x", "source": "a", "target": "s", "type": "audio"}]}
    assert G.validate(g) == []

def test_loop_edges_are_ignored_for_ordering_end_nodes_and_inputs(linear_graph):
    linear_graph["edges"].append({"id": "back", "source": "r", "target": "e", "type": "text", "max_loops": 2})
    assert G.end_nodes(linear_graph) == ["r"]                         # r still counts as an end node
    assert [e["source"] for e in G.predecessors(linear_graph, "e")] == ["p"]   # feedback isn't a normal input
    assert [e["target"] for e in G.loop_edges_from(linear_graph, "r")] == ["e"]

def test_diamond_orders_parents_before_join():
    g = {"nodes": [{"id": i, "kind": "llm", "model": "m"} for i in "abcd"],
         "edges": [{"id": "1", "source": "a", "target": "b"}, {"id": "2", "source": "a", "target": "c"},
                   {"id": "3", "source": "b", "target": "d"}, {"id": "4", "source": "c", "target": "d"}]}
    order = G.topo_order(g)
    assert order[0] == "a" and order[-1] == "d" and set(order[1:3]) == {"b", "c"}
    assert G.end_nodes(g) == ["d"]

def test_max_loops_zero_is_treated_as_a_normal_edge(linear_graph):
    # max_loops=0 is falsy, so r->e becomes a forward edge and creates a cycle
    linear_graph["edges"].append({"id": "back", "source": "r", "target": "e", "max_loops": 0})
    assert any("cycle" in p for p in G.validate(linear_graph))
