"""Phase 6: one real squad run end-to-end through the API, streaming events.
Usage: python scripts/smoke_run.py   (needs scripts/.ids from api_check.sh and the server running)"""
import json, sys, time, httpx
from pathlib import Path

B = "http://localhost:8000"
ids = dict(l.strip().split("=", 1) for l in (Path(__file__).parent / ".ids").read_text().splitlines())
run = httpx.post(f"{B}/runs", json={"session_id": ids["SESSION_ID"], "task_id": ids["TASK_ID"]}, timeout=30).json()
rid = run["id"]
print("run:", rid, "status:", run["status"])

with httpx.stream("GET", f"{B}/runs/{rid}/stream", timeout=None) as s:
    for line in s.iter_lines():
        if not line.startswith("data:"): continue
        ev = json.loads(line[5:])
        t = ev.get("type")
        if t == "node_start": print(f"  ▶ {ev['node_id']} (loop {ev.get('loop_index',0)})")
        elif t == "node_done":
            r = ev["result"]; print(f"  ✔ {ev['node_id']}: {r['input_tokens']}+{r['output_tokens']} tok, ${float(r['cost_usd']):.5f}, {r['latency_ms']} ms  [{r['model_or_tool']}]")
        elif t == "loop": print(f"  ↩ {ev['from_node']} → {ev['to_node']} (revision {ev['loop_index']})")
        elif t == "checkpoint_waiting": print(f"  ⏸ checkpoint {ev['node_id']} waiting")
        elif t in ("run_done", "run_failed"):
            print(t.upper(), ev.get("totals") or ev.get("error")); break

m = httpx.get(f"{B}/runs/{rid}/metrics").json()
print("\nPer-node metrics:")
for n in m["nodes"]:
    print(f"  {n['node_id']:<4} {n['role'] or n['node_kind']:<10} {n['model_or_tool']:<32} calls={n['calls']} tok={n['input_tokens']}+{n['output_tokens']} ${float(n['cost_usd']):.5f} ({n['cost_share']:.0%}) {n['latency_ms']}ms ({n['time_share']:.0%})")
print("Totals:", m["totals"]); print("Projection:", m["projection"])
final = httpx.get(f"{B}/runs/{rid}").json()["final_output"]
print("\nFinal output (first 600 chars):\n", (final or "")[:600])
print("\nMessages:", [(x["from_node"], x["to_node"]) for x in httpx.get(f"{B}/runs/{rid}/messages").json()])
