"""Price table behaviour (app/providers/pricing.py)."""
import pytest
from app.providers import pricing

def test_live_prices_override_fallback(monkeypatch):
    monkeypatch.setattr(pricing, "_live", {"anthropic/claude-haiku-5.5": (1.0, 2.0)})
    assert pricing.price_for("anthropic/claude-haiku-5.5") == (1.0, 2.0)
    assert [m["id"] for m in pricing.known_models()] == ["anthropic/claude-haiku-5.5"]

def test_known_models_falls_back_when_offline(monkeypatch):
    monkeypatch.setattr(pricing, "_live", {})
    ids = [m["id"] for m in pricing.known_models()]
    assert "anthropic/claude-sonnet-5.5" in ids and ids == sorted(ids)

def test_cached_tokens_cost_ten_percent():
    full = pricing.llm_cost("anthropic/claude-sonnet-5.5", 1_000_000, 0)
    cached = pricing.llm_cost("anthropic/claude-sonnet-5.5", 1_000_000, 0, cached_tokens=1_000_000)
    assert cached == pytest.approx(full * 0.1)

def test_variable_price_models_never_cost_negative(monkeypatch):
    monkeypatch.setattr(pricing, "_live", {"openrouter/auto": (-1e6, -1e6)})
    assert pricing.llm_cost("openrouter/auto", 1000, 1000) >= 0

def test_router_models_still_show_variable_price_in_model_list(monkeypatch):
    monkeypatch.setattr(pricing, "_live", {"openrouter/auto": (-1e6, -1e6)})
    m = next(x for x in pricing.known_models() if x["id"] == "openrouter/auto")
    assert m["input_per_m"] < 0          # the model picker uses this to display "variable price"
