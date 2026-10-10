import os
from pathlib import Path
from dotenv import load_dotenv

# .env lives at the repo root (one level above backend/)
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# Judge: a model NOT used inside squads being compared. Override in .env if you like.
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "anthropic/claude-sonnet-4.5")

# Guardrails
DEFAULT_MAX_TOKENS = int(os.environ.get("DEFAULT_MAX_TOKENS", "1500"))
DEFAULT_MAX_LOOPS = int(os.environ.get("DEFAULT_MAX_LOOPS", "2"))
NODE_TIMEOUT_S = int(os.environ.get("NODE_TIMEOUT_S", "120"))
RUN_COST_CAP_USD = float(os.environ.get("RUN_COST_CAP_USD", "2.0"))
AUDIO_DIR = Path(os.environ.get("AUDIO_DIR", Path(__file__).resolve().parents[1] / "audio"))
AUDIO_DIR.mkdir(parents=True, exist_ok=True)
