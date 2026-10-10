import os, psycopg
from dotenv import load_dotenv
load_dotenv("../.env")

with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
    print("Postgres:", conn.execute("SELECT version()").fetchone()[0][:40])
    ext = conn.execute(
        "SELECT extversion FROM pg_extension WHERE extname='timescaledb'"
    ).fetchone()
    print("TimescaleDB:", ext[0] if ext else "NOT INSTALLED")