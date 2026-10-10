# LLMSquad (working name)

**Which AI team should do this job?** Build a squad of models (Claude, Gemini, GPT, open-weight, plus ElevenLabs tools), wire who talks to whom, run the same task on several squads, and see which one wins on quality, cost, time and human effort.

Built at HackRU, Oct 2026.

## Features
- Visual squad builder (React Flow): drag arrows to change communication direction, loop edges with `max_loops`, typed text/audio ports
- Roles + custom skills attached to any LLM node
- Graph runner: parallel branches, feedback loops, **human checkpoint nodes** (approve / edit / reject)
- Per-node tokens, cost, time, share-of-cost, projection per 1k runs (TimescaleDB hypertables)
- Evaluation: **LLM judge** (per node + final), **human judge** with LLM-parsed feedback quality, sandboxed test cases, completion rule tests > human > judge
- **Fork and replay** from any node: upstream results reused at $0
- Compare view with live weight sliders

## Run it
```bash
# 1. database (Docker)
docker run -d --name squad-db -p 5433:5432 -e POSTGRES_PASSWORD=squad -v squad-db-data:/var/lib/postgresql/data timescale/timescaledb:latest-pg16
# 2. backend
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
cp ../.env.example ../.env   # fill OPENROUTER_API_KEY, ELEVENLABS_API_KEY, DATABASE_URL
python -m app.db.migrate
uvicorn app.main:app --reload --port 8000
# 3. frontend
cd frontend && npm install && npm run dev      # http://localhost:3000
# 4. demo data
python demo/seed.py
```
Tests: `cd backend && python -m pytest -q` (24 tests, no API calls). Live smoke: `bash scripts/api_check.sh && python scripts/smoke_run.py && python scripts/smoke_eval.py`.

## Docs
`PROJECT_STRUCTURE.md` (full design) · `diagrams/` (architecture, run lifecycle, sequences, ERD)
