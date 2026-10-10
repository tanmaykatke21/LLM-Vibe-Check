from app.core import graph as G

def test_valid_linear(linear_graph):
    assert G.validate(linear_graph) == []
    assert G.topo_order(linear_graph) == ["p", "e", "r"]
    assert G.end_nodes(linear_graph) == ["r"]

def test_cycle_without_max_loops_is_invalid(linear_graph):
    linear_graph["edges"].append({"id": "back", "source": "r", "target": "e", "type": "text"})
    probs = G.validate(linear_graph)
    assert any("cycle" in p for p in probs)

def test_loop_edge_is_allowed(linear_graph):
    linear_graph["edges"].append({"id": "back", "source": "r", "target": "e", "type": "text", "max_loops": 2})
    assert G.validate(linear_graph) == []
    assert G.topo_order(linear_graph) == ["p", "e", "r"]

def test_port_type_mismatch():
    g = {"nodes": [
        {"id": "w", "kind": "llm", "role": "writer", "model": "m"},
        {"id": "stt", "kind": "tool", "tool": "elevenlabs.stt"},
    ], "edges": [{"id": "x", "source": "w", "target": "stt", "type": "text"}]}
    probs = G.validate(g)
    assert any("does not accept text" in p for p in probs)

def test_tts_then_stt_is_valid():
    g = {"nodes": [
        {"id": "w", "kind": "llm", "role": "writer", "model": "m"},
        {"id": "tts", "kind": "tool", "tool": "elevenlabs.tts"},
        {"id": "stt", "kind": "tool", "tool": "elevenlabs.stt"},
    ], "edges": [{"id": "a", "source": "w", "target": "tts", "type": "text"},
                 {"id": "b", "source": "tts", "target": "stt", "type": "audio"}]}
    assert G.validate(g) == []

def test_llm_without_model_flagged():
    assert G.validate({"nodes": [{"id": "x", "kind": "llm"}], "edges": []})
