"""Price table in USD per 1M tokens (input, output). Updated from OpenRouter /models at startup
when possible; these are fallbacks so cost is never zero."""
import httpx
from app.config import OPENROUTER_API_KEY

FALLBACK_PRICES: dict[str, tuple[float, float]] = {
    # Anthropic (per platform.claude.com pricing, Oct 2026)
    "anthropic/claude-fable-5.1": (10.0, 50.0),
    "anthropic/claude-opus-5.5": (4.0, 20.0),
    "anthropic/claude-sonnet-5.5": (2.0, 10.0),
    "anthropic/claude-haiku-5.5": (0.10, 0.50),
    "anthropic/claude-sonnet-4.5": (3.0, 15.0),
    "anthropic/claude-haiku-4.5": (1.0, 5.0),
}
_live: dict[str, tuple[float, float]] = {}

# ElevenLabs approx: $ per 1k characters (TTS), $ per minute (STT). Adjust to your plan.
TOOL_PRICES = {
    "elevenlabs.tts": 0.030,   # per 1k chars (Flash v2.5-ish)
    "elevenlabs.stt": 0.004,   # per second of audio
}

async def refresh_from_openrouter() -> int:
    """Pull live prices. Returns number of models loaded (0 if offline)."""
    if not OPENROUTER_API_KEY:
        return 0
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get("https://openrouter.ai/api/v1/models",
                            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"})
            r.raise_for_status()
            for m in r.json().get("data", []):
                p = m.get("pricing") or {}
                try:
                    _live[m["id"]] = (float(p.get("prompt", 0)) * 1e6, float(p.get("completion", 0)) * 1e6)
                except (TypeError, ValueError):
                    pass
        return len(_live)
    except Exception:
        return 0

def price_for(model: str) -> tuple[float, float]:
    return _live.get(model) or FALLBACK_PRICES.get(model) or (1.0, 5.0)

def llm_cost(model: str, input_tokens: int, output_tokens: int, cached_tokens: int = 0) -> float:
    pin, pout = price_for(model)
    uncached = max(input_tokens - cached_tokens, 0)
    return round((uncached * pin + cached_tokens * pin * 0.1 + output_tokens * pout) / 1e6, 6)

def tool_cost(tool: str, units: float) -> float:
    if tool == "elevenlabs.tts":
        return round(units / 1000 * TOOL_PRICES[tool], 6)
    if tool == "elevenlabs.stt":
        return round(units * TOOL_PRICES[tool], 6)
    return 0.0

def known_models() -> list[dict]:
    src = _live or FALLBACK_PRICES
    return [{"id": k, "input_per_m": v[0], "output_per_m": v[1]} for k, v in sorted(src.items())]
