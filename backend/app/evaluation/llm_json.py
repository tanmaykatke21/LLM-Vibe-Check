"""Call the judge model and parse a JSON object out of its reply."""
import json, re
from app.config import JUDGE_MODEL
from app.providers.openrouter import OpenRouterProvider

async def ask_json(system: str, user: str, model: str | None = None, max_tokens: int = 2000) -> tuple[dict, dict]:
    """Returns (parsed_json, meta{cost_usd, tokens, model})."""
    node = {"id": "judge", "kind": "llm", "model": model or JUDGE_MODEL, "role": "judge",
            "system_prompt": system + "\nRespond with ONLY a JSON object, no prose, no code fences.",
            "params": {"max_tokens": max_tokens, "temperature": 0}}
    res = await OpenRouterProvider().run(node, user, [])
    text = res.output.strip()
    m = re.search(r"\{.*\}", text, re.S)
    try:
        data = json.loads(m.group(0) if m else text)
    except json.JSONDecodeError:
        data = {"_parse_error": True, "_raw": text[:500]}
    return data, {"cost_usd": res.cost_usd, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens, "model": res.model_or_tool}
