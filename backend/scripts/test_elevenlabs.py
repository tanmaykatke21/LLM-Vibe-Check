import os, httpx
from dotenv import load_dotenv
load_dotenv("../.env")

key = os.environ.get("ELEVENLABS_API_KEY", "")
print("Key loaded:", bool(key), "| length:", len(key))
H = {"xi-api-key": key}

# 1. Try listing voices (needs Voices: Read permission)
r = httpx.get("https://api.elevenlabs.io/v1/voices", headers=H, timeout=30)
print("List voices ->", r.status_code)
if r.status_code == 200:
    voices = r.json()["voices"]
    for v in voices[:5]:
        print("  ", v["voice_id"], v["name"])
    voice_id = voices[0]["voice_id"]
else:
    print("  Error body:", r.text[:300])
    voice_id = "21m00Tcm4TlvDq8ikWAM"   # ElevenLabs default premade voice
    print("  Falling back to default voice:", voice_id)

# 2. Text-to-speech (needs Text to Speech permission)
r = httpx.post(f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}", headers=H, timeout=60,
               json={"text": "Squad online. Ready for evaluation.", "model_id": "eleven_flash_v2_5"})
print("Text-to-speech ->", r.status_code)
if r.status_code != 200:
    print("  Error body:", r.text[:300])
    raise SystemExit(1)

open("test.mp3", "wb").write(r.content)
print("Saved test.mp3,", len(r.content), "bytes")
