"""Apply schema.sql. Safe to re-run. Usage: python -m app.db.migrate"""
from pathlib import Path
import psycopg
from app.config import DATABASE_URL

def apply(url: str = DATABASE_URL) -> None:
    """Create/upgrade all tables. Idempotent: every statement in schema.sql uses IF NOT EXISTS."""
    sql = (Path(__file__).parent / "schema.sql").read_text()
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(sql)

def main():
    apply()
    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        tables = [r[0] for r in conn.execute(
            "select tablename from pg_tables where schemaname='public' order by 1")]
        hyper = [r[0] for r in conn.execute(
            "select hypertable_name from timescaledb_information.hypertables")]
        caggs = [r[0] for r in conn.execute(
            "select view_name from timescaledb_information.continuous_aggregates")]
    print("tables:", ", ".join(tables))
    print("hypertables:", len(hyper), hyper)
    print("continuous aggregates:", caggs)
    print("OK")

if __name__ == "__main__":
    main()
