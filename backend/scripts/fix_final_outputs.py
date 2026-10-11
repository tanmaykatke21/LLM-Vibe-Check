"""Re-derive final_output for past runs whose last node is a reviewer (loop edge back).
Old runs stored the reviewer's verdict as the final output; the deliverable is the reviewed node's latest output.
After running this, click "Run judge" again on affected runs so tests + judge score the real work."""
import os, json, psycopg
from pathlib import Path
from dotenv import load_dotenv
from psycopg.rows import dict_row
load_dotenv(Path(__file__).resolve().parents[2] / ".env")
with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True, row_factory=dict_row) as c:
    fixed = 0
    for run in c.execute("select id, graph_snapshot from runs where status='done'").fetchall():
        g = run["graph_snapshot"] if isinstance(run["graph_snapshot"], dict) else json.loads(run["graph_snapshot"])
        edges = g.get("edges", [])
        loops = [e for e in edges if e.get("max_loops")]  # same rule as graph.is_loop_edge
        fwd_sources = {e["source"] for e in edges if e not in loops}
        ends = [n["id"] for n in g.get("nodes", []) if n["id"] not in fwd_sources]
        parts = []
        for end in ends:
            le = next((e for e in loops if e["source"] == end), None)
            nid = le["target"] if le else end
            row = c.execute("""select output from node_results where run_id=%s and node_id=%s and status='done'
                               order by loop_index desc, ts desc limit 1""", (run["id"], nid)).fetchone()
            if row and row["output"]: parts.append(row["output"])
        if parts and any(e for e in loops if e["source"] in ends):
            c.execute("update runs set final_output=%s where id=%s", ("\n\n---\n\n".join(parts), run["id"]))
            fixed += 1
    print(f"re-derived final output for {fixed} run(s) that ended in a reviewer. Now click 'Run judge' on them again.")
