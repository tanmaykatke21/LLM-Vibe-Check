"""Provider calls with the network replaced by a fake server (httpx.MockTransport). No API keys or credits used."""
import json, httpx, pytest
from app.providers import openrouter as ORmod
from app.providers import elevenlabs as ELmod
from app.providers.openrouter import OpenRouterProvider
from app.providers.elevenlabs import ElevenLabsTTS, ElevenLabsSTT

_RealClient = httpx.AsyncClient

def fake_network(monkeypatch, handler):
    """Every httpx.AsyncClient(...) created by the code under test talks to `handler` instead of the internet."""
    sent = []
    def wrapped(request):
        sent.append(request)
        return handler(request)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: _RealClient(transport=httpx.MockTransport(wrapped)))
    return sent

def chat_reply(content, usage=None, finish="stop"):
    return httpx.Response(200, json={"choices": [{"message": {"content": content}, "finish_reason": finish}],
                                     "usage": usage or {"prompt_tokens": 100, "completion_tokens": 20}})

NODE = {"id": "e", "kind": "llm", "role": "executor", "model": "anthropic/claude-haiku-5.5", "system_prompt": "You build."}

async def test_openrouter_request_shape_and_result(monkeypatch):
    sent = fake_network(monkeypatch, lambda req: chat_reply("done", {"prompt_tokens": 100, "completion_tokens": 20, "cost": 0.0042}))
    res = await OpenRouterProvider().run(NODE, "the prompt", [])
    body = json.loads(sent[0].content)
    assert sent[0].url.path.endswith("/chat/completions")
    assert body["model"] == "anthropic/claude-haiku-5.5" and body["max_tokens"] == 1500 and body["temperature"] == 0.3
    assert body["messages"] == [{"role": "system", "content": "You build."}, {"role": "user", "content": "the prompt"}]
    assert "reasoning" not in body
    assert (res.output, res.input_tokens, res.output_tokens, res.cost_usd) == ("done", 100, 20, 0.0042)

async def test_openrouter_falls_back_to_price_table_when_no_cost_reported(monkeypatch):
    fake_network(monkeypatch, lambda req: chat_reply("ok", {"prompt_tokens": 1_000_000, "completion_tokens": 0}))
    res = await OpenRouterProvider().run(NODE, "p", [])
    assert res.cost_usd == pytest.approx(0.10)          # haiku 5.5 fallback: $0.10 per 1M input

async def test_reasoning_effort_and_max_tokens_params_are_sent(monkeypatch):
    sent = fake_network(monkeypatch, lambda req: chat_reply("ok"))
    await OpenRouterProvider().run({**NODE, "params": {"reasoning_effort": "low", "max_tokens": 6000}}, "p", [])
    body = json.loads(sent[0].content)
    assert body["reasoning"] == {"effort": "low"} and body["max_tokens"] == 6000

async def test_thinking_model_that_runs_out_of_tokens_explains_itself(monkeypatch):
    fake_network(monkeypatch, lambda req: chat_reply(None, finish="length"))
    res = await OpenRouterProvider().run(NODE, "p", [])
    assert res.output.startswith("[no answer") and "max_tokens" in res.output

async def test_out_of_credits_raises_http_error(monkeypatch):
    fake_network(monkeypatch, lambda req: httpx.Response(402, json={"error": {"message": "Insufficient credits"}}))
    with pytest.raises(httpx.HTTPStatusError) as ex:
        await OpenRouterProvider().run(NODE, "p", [])
    assert ex.value.response.status_code == 402

async def test_tts_saves_mp3_truncates_text_and_charges_per_char(monkeypatch, tmp_path):
    monkeypatch.setattr(ELmod, "AUDIO_DIR", tmp_path)
    sent = fake_network(monkeypatch, lambda req: httpx.Response(200, content=b"ID3fake-mp3"))
    res = await ElevenLabsTTS().run({"id": "t", "params": {"max_chars": 5}}, "Hello listeners", [])
    assert json.loads(sent[0].content)["text"] == "Hello"
    assert res.output_kind == "audio" and res.units == 5 and res.cost_usd > 0
    assert open(res.output, "rb").read() == b"ID3fake-mp3" and res.output.startswith(str(tmp_path))

async def test_stt_needs_an_audio_input():
    with pytest.raises(ValueError, match="needs an audio input"):
        await ElevenLabsSTT().run({"id": "s"}, "", [{"kind": "text", "content": "hi"}])

async def test_stt_transcribes_and_bills_by_duration(monkeypatch, tmp_path):
    audio = tmp_path / "a.mp3"; audio.write_bytes(b"ID3")
    fake_network(monkeypatch, lambda req: httpx.Response(200, json={"text": "hello world", "duration": 12.5}))
    res = await ElevenLabsSTT().run({"id": "s"}, "", [{"kind": "audio", "content": str(audio)}])
    assert res.output == "hello world" and res.units == 12.5
    assert res.cost_usd == pytest.approx(12.5 * 0.004)
