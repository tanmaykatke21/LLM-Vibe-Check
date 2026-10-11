from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import r as api
from app.api.eval_routes import r as eval_api
from app.providers.pricing import refresh_from_openrouter
from app.config import AUDIO_DIR, ALLOWED_ORIGINS, ALLOWED_ORIGIN_REGEX, AUTO_MIGRATE

@asynccontextmanager
async def lifespan(app: FastAPI):
    if AUTO_MIGRATE:
        try:
            from app.db.migrate import apply
            apply()
            print("[db] schema ready")
        except Exception as ex:   # never block startup; /health will report the database problem
            print(f"[db] schema check failed: {type(ex).__name__}: {ex}")
    n = await refresh_from_openrouter()
    print(f"[pricing] loaded {n} models from OpenRouter" if n else "[pricing] using fallback prices (offline?)")
    yield

app = FastAPI(title="LLMVibeCheck API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_origin_regex=ALLOWED_ORIGIN_REGEX,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(api)
app.include_router(eval_api)
app.mount("/audio", StaticFiles(directory=str(AUDIO_DIR)), name="audio")

@app.get("/health")
def health():
    """Also pings the database, so 'is the DB up?' is one curl away."""
    from app.db.client import one
    try:
        one("select 1 as ok")
        return {"status": "ok", "db": "ok"}
    except Exception as ex:
        return {"status": "degraded", "db": f"unreachable: {type(ex).__name__}. Check DATABASE_URL (running locally? docker start squad-db)"}
