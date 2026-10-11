from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import r as api
from app.api.eval_routes import r as eval_api
from app.providers.pricing import refresh_from_openrouter
from app.config import AUDIO_DIR

@asynccontextmanager
async def lifespan(app: FastAPI):
    n = await refresh_from_openrouter()
    print(f"[pricing] loaded {n} models from OpenRouter" if n else "[pricing] using fallback prices (offline?)")
    yield

app = FastAPI(title="LLMSquad API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
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
        return {"status": "degraded", "db": f"unreachable: {type(ex).__name__}. Is the Docker container running? -> docker start squad-db"}
