import time, uuid, httpx
from app.config import ELEVENLABS_API_KEY, AUDIO_DIR, NODE_TIMEOUT_S
from app.providers.base import Provider, NodeResult
from app.providers.pricing import tool_cost

H = {"xi-api-key": ELEVENLABS_API_KEY}
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"

class ElevenLabsTTS(Provider):
    """text -> audio file (mp3). node.params: voice_id, model (default eleven_flash_v2_5)"""
    async def run(self, node: dict, prompt: str, inputs: list[dict]) -> NodeResult:
        p = node.get("params") or {}
        voice = p.get("voice_id", DEFAULT_VOICE)
        model = p.get("model", "eleven_flash_v2_5")
        text = prompt[: int(p.get("max_chars", 2500))]
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=NODE_TIMEOUT_S) as c:
            r = await c.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice}", headers=H,
                             json={"text": text, "model_id": model})
            r.raise_for_status()
        ms = int((time.perf_counter() - t0) * 1000)
        path = AUDIO_DIR / f"{uuid.uuid4()}.mp3"
        path.write_bytes(r.content)
        return NodeResult(output=str(path), output_kind="audio", units=len(text),
                          cost_usd=tool_cost("elevenlabs.tts", len(text)), latency_ms=ms,
                          model_or_tool=f"elevenlabs.tts/{model}")

class ElevenLabsSTT(Provider):
    """audio file -> text. Expects the upstream input to be an audio path."""
    async def run(self, node: dict, prompt: str, inputs: list[dict]) -> NodeResult:
        audio_inputs = [i for i in inputs if i.get("kind") == "audio"]
        if not audio_inputs:
            raise ValueError("STT node needs an audio input")
        path = audio_inputs[0]["content"]
        p = node.get("params") or {}
        t0 = time.perf_counter()
        async with httpx.AsyncClient(timeout=NODE_TIMEOUT_S) as c:
            with open(path, "rb") as f:
                r = await c.post("https://api.elevenlabs.io/v1/speech-to-text", headers=H,
                                 data={"model_id": p.get("model", "scribe_v1")},
                                 files={"file": ("audio.mp3", f, "audio/mpeg")})
            r.raise_for_status()
            d = r.json()
        ms = int((time.perf_counter() - t0) * 1000)
        text = d.get("text", "")
        secs = float(d.get("duration", 0) or 0) or max(len(text) / 15, 1)  # ~15 chars/sec fallback
        return NodeResult(output=text, units=secs, cost_usd=tool_cost("elevenlabs.stt", secs),
                          latency_ms=ms, model_or_tool=f"elevenlabs.stt/{p.get('model','scribe_v1')}")
