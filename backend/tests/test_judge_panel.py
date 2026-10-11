"""Panel-of-judges aggregation (pure function, no LLM calls)."""
from app.evaluation.judge import aggregate

def V(model, final_score, complete, nodes):
    return {"model": model, "data": {"final": {"accuracy_score": final_score, "complete": complete, "missing": [f"{model} gap"], "rationale": "r"},
                                     "nodes": [{"node_id": nid, "accuracy_score": s, "did_its_job": ok, "issues": [i], "rationale": "x"} for nid, s, ok, i in nodes]}}

def test_mean_majority_and_spread():
    agg = aggregate([
        V("anthropic/claude", 9, True,  [("e", 8, True, "Missing docstring")]),
        V("openai/gpt",       6, False, [("e", 5, False, "missing docstring")]),   # duplicate issue, different case
        V("google/gemini",    9, True,  [("e", 8, True, "No input validation")]),
    ])
    f = agg["final"]
    assert f["accuracy_score"] == 8.0 and f["complete"] is True and f["spread"] == 3.0
    assert f["by_judge"] == {"anthropic/claude": 9, "openai/gpt": 6, "google/gemini": 9}
    e = agg["nodes"][0]
    assert e["node_id"] == "e" and e["accuracy_score"] == 7.0 and e["did_its_job"] is True and e["spread"] == 3.0
    assert e["issues"] == ["Missing docstring", "No input validation"]          # merged, de-duplicated

def test_tie_is_not_complete_and_single_judge_has_zero_spread():
    agg = aggregate([V("a/x", 8, True, []), V("b/y", 4, False, [])])
    assert agg["final"]["complete"] is False and agg["final"]["accuracy_score"] == 6.0
    one = aggregate([V("a/x", 7, True, [("p", 6, True, "i")])])
    assert one["final"]["spread"] == 0.0 and one["nodes"][0]["spread"] == 0.0

def test_judge_that_omits_a_node_is_skipped_for_that_node():
    agg = aggregate([V("a/x", 8, True, [("p", 8, True, "i"), ("e", 4, False, "j")]), V("b/y", 8, True, [("p", 6, True, "k")])])
    e = next(n for n in agg["nodes"] if n["node_id"] == "e")
    assert e["accuracy_score"] == 4.0 and e["by_judge"] == {"a/x": 4}
