from app.providers.base import Provider, NodeResult
from app.providers.openrouter import OpenRouterProvider
from app.providers.elevenlabs import ElevenLabsTTS, ElevenLabsSTT

TOOL_PROVIDERS = {
    "elevenlabs.tts": ElevenLabsTTS,
    "elevenlabs.stt": ElevenLabsSTT,
}

def provider_for(node: dict) -> Provider:
    kind = node.get("kind", "llm")
    if kind == "llm":
        return OpenRouterProvider()
    if kind == "tool":
        cls = TOOL_PROVIDERS.get(node.get("tool", ""))
        if not cls:
            raise ValueError(f"Unknown tool: {node.get('tool')}")
        return cls()
    raise ValueError(f"No provider for node kind {kind}")
