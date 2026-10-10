"""Remove duplicate skills/sessions/tasks created by repeated api_check.sh runs (keeps the ones that have runs)."""
import os, psycopg
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as c:
    n = c.execute("""delete from skills s where name='Python style' and not exists
        (select 1 from sessions x where x.graph::text like '%%'||s.id::text||'%%') and id <> (select min(id::text)::uuid from skills where name='Python style')""").rowcount
    m = c.execute("delete from sessions s where name='All-Haiku' and not exists (select 1 from runs r where r.session_id=s.id)").rowcount
    t = c.execute("delete from tasks t where title='Date parser' and not exists (select 1 from runs r where r.task_id=t.id)").rowcount
    print(f"removed {n} duplicate skills, {m} unused All-Haiku sessions, {t} unused Date parser tasks")
