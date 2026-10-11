import os
from pathlib import Path
from dotenv import load_dotenv

# .env lives at the repo root (one level above backend/)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# Judge: a model NOT used inside squads being compared. Override in .env if you like.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "anthropic/claude-sonnet-4.5")   # single-model helper (human-feedback parsing)
# Panel of judges from different companies: each scores independently, the app averages them and reports disagreement.
JUDGE_PANEL = [m.strip() for m in os.environ.get(
    "JUDGE_PANEL", "anthropic/claude-sonnet-5.5,openai/gpt-5.4,google/gemini-3.1-pro-preview").split(",") if m.strip()]

# Which websites may call this API (comma-separated). Add your Vercel URL when hosting.
ALLOWED_ORIGINS = [o.strip().rstrip("/") for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000").split(",") if o.strip()]
ALLOWED_ORIGIN_REGEX = os.environ.get("ALLOWED_ORIGIN_REGEX") or None   # e.g. https://llmvibecheck-.*\.vercel\.app for preview deploys
AUTO_MIGRATE = os.environ.get("AUTO_MIGRATE", "1") == "1"            # create tables on startup if missing

# Guardrails
DEFAULT_MAX_TOKENS = int(os.environ.get("DEFAULT_MAX_TOKENS", "1500"))
DEFAULT_MAX_LOOPS = int(os.environ.get("DEFAULT_MAX_LOOPS", "2"))
NODE_TIMEOUT_S = int(os.environ.get("NODE_TIMEOUT_S", "120"))
RUN_COST_CAP_USD = float(os.environ.get("RUN_COST_CAP_USD", "2.0"))
AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", Path(__file__).resolve().parents[1] / "audio"))
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
