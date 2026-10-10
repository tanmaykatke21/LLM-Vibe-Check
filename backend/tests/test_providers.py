from app.providers.pricing import llm_cost, tool_cost, price_for
from app.providers import provider_for, OpenRouterProvider, ElevenLabsTTS

def test_llm_cost_uses_fallback_prices():
    # haiku 5.5: $0.10 in / $0.50 out per 1M
    assert llm_cost("anthropic/claude-haiku-5.5", 1_000_000, 0) == 0.10
    assert llm_cost("anthropic/claude-haiku-5.5", 0, 1_000_000) == 0.50

def test_cached_tokens_are_discounted():
    full = llm_cost("anthropic/claude-opus-5.5", 10_000, 0)
    cached = llm_cost("anthropic/claude-opus-5.5", 10_000, 0, cached_tokens=10_000)
    assert cached < full

def test_unknown_model_has_nonzero_price():
    assert price_for("some/unknown-model") != (0, 0)

def test_tool_cost():
    assert tool_cost("elevenlabs.tts", 1000) > 0
    assert tool_cost("elevenlabs.stt", 10) > 0
    assert tool_cost("nope", 10) == 0

def test_provider_routing():
    assert isinstance(provider_for({"kind": "llm", "model": "x"}), OpenRouterProvider)
    assert isinstance(provider_for({"kind": "tool", "tool": "elevenlabs.tts"}), ElevenLabsTTS)
