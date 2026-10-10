import os, httpx
from dotenv import load_dotenv
load_dotenv("../.env")
KEY = os.environ["OPENROUTER_API_KEY"]
H = {"Authorization": f"Bearer {KEY}"}

# 1. List available Claude / Gemini / GPT model IDs
models = httpx.get("https://openrouter.ai/api/v1/models", headers=H).json()["data"]
for m in models:
    if any(p in m["id"] for p in ["anthropic/", "google/gemini", "openai/gpt"]):
        print(m["id"])

# 2. One cheap test call. Paste a real ID from the list above.
MODEL = input("\nPaste a cheap model ID to test: ").strip()
r = httpx.post("https://openrouter.ai/api/v1/chat/completions", headers=H, timeout=60,
    json={"model": MODEL, "messages": [{"role": "user", "content": "Reply with exactly: squad online"}]})
r.raise_for_status()
d = r.json()
print("Reply:", d["choices"][0]["message"]["content"])
print("Usage:", d["usage"])
