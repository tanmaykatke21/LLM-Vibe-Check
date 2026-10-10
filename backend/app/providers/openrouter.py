import time, httpx
from app.config import OPENROUTER_API_KEY, DEFAULT_MAX_TOKENS, NODE_TIMEOUT_S
from app.providers.base import Provider, NodeResult
from app.providers.pricing import llm_cost

URL = "https://openrouter.ai/api/v1/chat/completions"

class OpenRouterProvider(Provider):
    async def run(self, node: dict, prompt: str, inputs: list[dict]) -> NodeResult:
        model = node["model"]
        params = node.get("params") or {}
        body = {
            "model": model,
            "messages": [
                {"role": "system", "content": node.get("system_prompt") or f"You are the {node.get('role','assistant')}."},
                {"role": "user", "content": prompt},
            ],
            "max_tokens": int(params.get("max_tokens", DEFAULT_MAX_TOKENS)),
            "temperature": float(params.get("temperature", 0.3)),
            "usage": {"include": True},
        }
        headers = {"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                   "HTTP-Referer": "https://llmsquad.local", "X-Title": "LLMSquad"}
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=NODE_TIMEOUT_S) as c:
            r = await c.post(URL, json=body, headers=headers)
            r.raise_for_status()
            d = r.json()
        ms = int((time.perf_counter() - t0) * 1000)
        text = d["choices"][0]["message"]["content"] or ""
        u = d.get("usage") or {}
        it, ot = int(u.get("prompt_tokens", 0)), int(u.get("completion_tokens", 0))
        cached = int((u.get("prompt_tokens_details") or {}).get("cached_tokens", 0))
        # OpenRouter may report exact cost; prefer it
        cost = float(u["cost"]) if u.get("cost") is not None else llm_cost(model, it, ot, cached)
        return NodeResult(output=text, input_tokens=it, output_tokens=ot, cached_tokens=cached,
                          cost_usd=round(cost, 6), latency_ms=ms, model_or_tool=model, raw={"usage": u})
