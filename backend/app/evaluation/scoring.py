"""0-100 scoring.

quality  (0-100, absolute, per run) = weighted average of the signals that exist:
           judge panel score (x10), hidden-test pass rate (x100), human rating (1 star = 0, 5 stars = 100).
cost / speed (0-100, RELATIVE to the other runs of the same task): best run = 100, a run costing 2x the best = 50.
effort   (0-100) = 100 with no human interventions, -34 per edit/rejection.
overall  = quality x (1 - efficiency penalty), where the penalty is the weighted shortfall of cost/speed/effort
           from 100, capped at 1.  So: a failed run scores ~0 however cheap it was, a perfect run that is also the
           cheapest and fastest scores 100, and nothing ever leaves 0-100.
"""

DEFAULT_WEIGHTS = {
    # how quality is blended (relative importance; any non-negative numbers)
    "quality": 1.0, "tests": 1.0, "human": 0.5,
    # how much being pricier / slower / needing help than the best squad costs (fractions of the score)
    "cost": 0.2, "speed": 0.1, "effort": 0.1,
}

def weights(w: dict | None) -> dict:
    out = {**DEFAULT_WEIGHTS}
    for k, v in (w or {}).items():
        if k in out and v is not None:
            out[k] = max(0.0, float(v))
    return out

def quality_score(judge_score: float | None, test_pass_rate: float | None, human_rating: float | None,
                  w: dict | None = None) -> float | None:
    """judge 0-10, pass rate 0-1, human rating 1-5. Returns 0-100, or None when nothing has been evaluated."""
    w = weights(w)
    parts = []
    if judge_score is not None: parts.append((w["quality"], float(judge_score) * 10))
    if test_pass_rate is not None: parts.append((w["tests"], float(test_pass_rate) * 100))
    if human_rating is not None: parts.append((w["human"], (float(human_rating) - 1) / 4 * 100))
    total_w = sum(x for x, _ in parts)
    if not parts or total_w == 0:
        return None
    return round(max(0.0, min(100.0, sum(x * v for x, v in parts) / total_w)), 1)

def _relative(value: float, best: float) -> float:
    """lower-is-better metric -> 0-100 where the best run gets 100."""
    if value <= 0 or best <= 0:
        return 100.0
    return round(100.0 * best / value, 1)

def score_runs(rows: list[dict], w: dict | None = None) -> list[dict]:
    """rows need: final_judge_score, test_pass_rate, human_score, total_cost, total_latency_ms, interventions_count.
    Adds quality_score, cost_score, speed_score, effort_score and composite_score (overall) to each row, in place."""
    w = weights(w)
    costs = [float(r.get("total_cost") or 0) for r in rows if float(r.get("total_cost") or 0) > 0]
    times = [float(r.get("total_latency_ms") or 0) for r in rows if float(r.get("total_latency_ms") or 0) > 0]
    best_cost, best_time = (min(costs) if costs else 0), (min(times) if times else 0)
    for r in rows:
        q = quality_score(r.get("final_judge_score"), r.get("test_pass_rate"), r.get("human_score"), w)
        c = _relative(float(r.get("total_cost") or 0), best_cost)
        s = _relative(float(r.get("total_latency_ms") or 0), best_time)
        e = max(0.0, 100.0 - 34.0 * int(r.get("interventions_count") or 0))
        penalty = min(1.0, w["cost"] * (1 - c / 100) + w["speed"] * (1 - s / 100) + w["effort"] * (1 - e / 100))
        r.update(quality_score=q, cost_score=c, speed_score=s, effort_score=e,
                 composite_score=None if q is None else round(q * (1 - penalty), 1))
    return rows
