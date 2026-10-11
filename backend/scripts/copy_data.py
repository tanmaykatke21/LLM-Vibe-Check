"""Copy all LLMVibeCheck data from one Postgres/TimescaleDB to another (e.g. local Docker -> TigerData cloud).

    python scripts/copy_data.py --to "postgres://...tsdb.cloud.timescale.com:PORT/tsdb?sslmode=require"
    python scripts/copy_data.py --to "..." --dry-run      # only show row counts, change nothing

The source defaults to DATABASE_URL from your .env (your local Docker database).
Creates the tables on the target if needed, refuses to copy into a target that already has runs
(so nothing is duplicated or overwritten), and never deletes anything anywhere.
"""
import argparse, os, sys
from pathlib import Path
import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.db.migrate import apply  # noqa: E402

# parents before children (foreign keys); ORDER BY keeps forks after the runs they came from
TABLES = [("skills", "created_at"), ("tasks", "created_at"), ("sessions", "created_at"), ("runs", "created_at"),
          ("node_results", "ts"), ("messages", "ts"), ("checkpoints", "created_at"), ("judge_results", "created_at"),
          ("human_feedback", "created_at"), ("evaluations", "updated_at")]

def columns(conn, table):
    return [r[0] for r in conn.execute(
        "select column_name from information_schema.columns where table_schema='public' and table_name=%s order by ordinal_position", (table,))]

def count(conn, table):
    return conn.execute(f"select count(*) from {table}").fetchone()[0]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", default=None, help="source database URL (default: DATABASE_URL from .env)")
    ap.add_argument("--to", dest="dst", required=True, help="target database URL (TigerData connection string)")
    ap.add_argument("--dry-run", action="store_true", help="only print row counts")
    a = ap.parse_args()
    if a.src is None:
        from app.config import DATABASE_URL
        a.src = DATABASE_URL
    if a.src.split("@")[-1] == a.dst.split("@")[-1]:
        sys.exit("Source and target are the same database. Nothing to do.")

    print("Connecting to source and target...")
    with psycopg.connect(a.src, autocommit=True) as src, psycopg.connect(a.dst, autocommit=True, connect_timeout=15) as dst:
        if not a.dry_run:
            print("Creating tables on the target if they don't exist...")
            apply(a.dst)
        print(f"\n{'table':16s} {'source':>8s} {'target':>8s}")
        for t, _ in TABLES:
            try: tgt = count(dst, t)
            except Exception: tgt = "-"
            print(f"{t:16s} {count(src, t):>8} {tgt:>8}")
        if a.dry_run:
            print("\nDry run: nothing copied."); return
        if count(dst, "runs") > 0:
            sys.exit("\nThe target already has runs. Stopping so nothing gets duplicated. (Use an empty TigerData service.)")

        # the one local user row (owner of tasks/sessions/skills)
        for (uid, email) in src.execute("select id, email from users").fetchall():
            dst.execute("insert into users (id, email) values (%s,%s) on conflict (id) do nothing", (uid, email))

        print("\nCopying...")
        with dst.transaction():
            for t, order in TABLES:
                cols = [c for c in columns(src, t) if c in set(columns(dst, t))]
                collist = ", ".join(cols)
                n = 0
                with src.cursor().copy(f"COPY (SELECT {collist} FROM {t} ORDER BY {order}) TO STDOUT") as out, \
                     dst.cursor().copy(f"COPY {t} ({collist}) FROM STDIN") as inp:
                    for chunk in out:
                        inp.write(chunk); n += len(chunk)
                print(f"  {t:16s} done ({n/1024:.0f} KB)")
        try:
            dst.execute("CALL refresh_continuous_aggregate('node_cost_hourly', NULL, NULL)")
        except Exception as ex:
            print(f"  (cost summary refresh skipped: {type(ex).__name__})")

        print(f"\n{'table':16s} {'source':>8s} {'target':>8s}")
        ok = True
        for t, _ in TABLES:
            s, d = count(src, t), count(dst, t); ok &= s == d
            print(f"{t:16s} {s:>8} {d:>8} {'' if s == d else '  <-- MISMATCH'}")
        print("\nAll rows copied." if ok else "\nSome tables don't match; see above.")

if __name__ == "__main__":
    main()
