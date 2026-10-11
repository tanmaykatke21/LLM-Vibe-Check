from app.evaluation.scoring import quality_score, score_runs

def run(judge=None, tests=None, human=None, cost=0.01, ms=10_000, interventions=0):
    return {"final_judge_score": judge, "test_pass_rate": tests, "human_score": human,
            "total_cost": cost, "total_latency_ms": ms, "interventions_count": interventions}

def test_quality_is_weighted_average_of_available_signals():
    assert quality_score(9, 1.0, None) == 95.0          # (90 + 100) / 2
    assert quality_score(None, 0.5, None) == 50.0
    assert quality_score(10, 1.0, 1) == 80.0            # human 1 star = 0: (100 + 100 + 0.5*0) / 2.5
    assert quality_score(None, None, None) is None      # never evaluated

def test_overall_is_bounded_and_failed_runs_score_zero():
    rows = score_runs([run(judge=10, tests=1.0), run(judge=0, tests=0.0, cost=0.001, ms=1000)])
    best, failed = rows
    assert failed["composite_score"] == 0.0            # cheapest + fastest can't rescue a failure
    assert 0 <= best["composite_score"] <= 100

def test_cost_and_speed_are_relative_to_best_run():
    a, b = score_runs([run(judge=10, tests=1.0, cost=0.01, ms=10_000), run(judge=10, tests=1.0, cost=0.02, ms=20_000)])
    assert (a["cost_score"], a["speed_score"]) == (100.0, 100.0) and a["composite_score"] == 100.0
    assert (b["cost_score"], b["speed_score"]) == (50.0, 50.0)
    assert b["composite_score"] == 85.0                 # 100 x (1 - 0.2*0.5 - 0.1*0.5)

def test_never_negative_even_with_huge_weights():
    rows = score_runs([run(judge=10, tests=1.0, cost=0.01), run(judge=10, tests=1.0, cost=5.0, ms=999_999, interventions=9)],
                      {"cost": 5, "speed": 5, "effort": 5})
    assert all(0 <= r["composite_score"] <= 100 for r in rows)

def test_unjudged_run_has_no_overall():
    (r,) = score_runs([run()])
    assert r["quality_score"] is None and r["composite_score"] is None
