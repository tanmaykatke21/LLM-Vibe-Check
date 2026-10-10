from dataclasses import dataclass, field
from typing import Any

@dataclass
class NodeResult:
    output: str                      # text output, or path to audio file for audio outputs
    output_kind: str = "text"        # text | audio
    input_tokens: int = 0
    output_tokens: int = 0
    cached_tokens: int = 0
    units: float | None = None       # chars (TTS) / seconds (STT) for tool nodes
    cost_usd: float = 0.0
    latency_ms: int = 0
    model_or_tool: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

class Provider:
    """Interface every provider implements."""
    async def run(self, node: dict, prompt: str, inputs: list[dict]) -> NodeResult:
        raise NotImplementedError
