"""Phase 6b: judge + human feedback + fork on the most recent finished run.
Usage: python scripts/smoke_eval.py"""
import json, time, httpx
B = "http://localhost:8000"
runs = [r for r in httpx.get(f"{B}/runs").json() if r["status"] == "done"]
assert runs, "no finished runs yet — run smoke_run.py first"
rid = runs[0]["id"]; print("evaluating run", rid)

resp = httpx.post(f"{B}/runs/{rid}/evaluate", timeout=180)
try:
    ev = resp.json()
except Exception:
    print("EVALUATE FAILED:", resp.status_code, resp.text[:800]); print("-> see the uvicorn terminal for the traceback"); raise SystemExit(1)
if resp.status_code != 200 or "judge_report" not in ev:
    print("EVALUATE FAILED:", resp.status_code, json.dumps(ev, indent=1)[:1500]); raise SystemExit(1)
if ev["judge_report"].get("parse_error"):
    print("JUDGE returned non-JSON; raw:", json.dumps(ev["judge_report"])[:800])
print("\nJUDGE per node:")
for n in ev["judge_report"]["nodes"]:
    print(f"  {n['node_id']}: {n['accuracy_score']}/10 did_its_job={n['did_its_job']} issues={n['issues'][:2]}")
print("JUDGE final:", ev["judge_report"]["final"].get("accuracy_score"), "complete:", ev["judge_report"]["final"].get("complete"))
print("judge cost: $%.5f" % ev["judge_report"]["judge"]["cost_usd"])
print("COMPLETION:", ev["completion_status"], "—", ev["completion_reason"], "| composite:", ev["composite_score"])

fb = httpx.post(f"{B}/runs/{rid}/feedback", json={"rating": 3, "complete": False,
      "feedback_text": "The function works for ISO dates but the 'Jan 5 2024' format is wrong; reviewer should have caught it."}, timeout=120).json()
pv = fb["feedback"]["parsed_verdict"]
print("\nHUMAN FEEDBACK parsed:", {k: pv.get(k) for k in ("sentiment", "feedback_quality", "agrees_with_judge", "blamed_nodes")})
print("COMPLETION now:", fb["completion_status"], "—", fb["completion_reason"])

# pick a fork model that exists on OpenRouter: prefer sonnet-5.5, else any anthropic model that isn't the current one
llms = [m["id"] for m in httpx.get(f"{B}/models").json()["llms"]]
cur = next((n["model_or_tool"] for n in httpx.get(f"{B}/runs/{rid}/nodes").json() if n["node_id"] == "e"), "")
fork_model = next((m for m in ["anthropic/claude-sonnet-5.5", "anthropic/claude-sonnet-4.5", "anthropic/claude-haiku-4.5"] if m in llms and m != cur), None) \
    or next((m for m in llms if m.startswith("anthropic/") and m != cur), llms[0])
print(f"\nFORK from executor: {cur} -> {fork_model}")
fk = httpx.post(f"{B}/runs/{rid}/fork", json={"from_node_id": "e", "node_changes": {"e": {"model": fork_model}}}, timeout=30).json()
print("fork run:", fk["id"], "reused:", fk["reused_nodes"], "changed:", fk["changed_nodes"])
with httpx.stream("GET", f"{B}/runs/{fk['id']}/stream", timeout=None) as s:
    for line in s.iter_lines():
        if line.startswith("data:"):
            e = json.loads(line[5:])
            if e.get("type") == "node_done":
                r = e["result"]; print(f"  ✔ {e['node_id']}: ${float(r['cost_usd']):.5f} [{r['model_or_tool']}]")
            if e.get("type") in ("run_done", "run_failed"): print(" ", e["type"].upper(), e.get("error") or ""); break
errs = [(n["node_id"], n["error"]) for n in httpx.get(f"{B}/runs/{fk['id']}/nodes").json() if n.get("error")]
if errs: print("  node errors:", errs)
m = httpx.get(f"{B}/runs/{fk['id']}/metrics").json()
p = next(n for n in m["nodes"] if n["node_id"] == "p")
print("planner in fork: reused =", p["reused"], "cost = $%.5f" % float(p["cost_usd"]))
print("\nFORK TREE:", [(r["id"][:8], r["forked_from_node"], r["depth"]) for r in httpx.get(f"{B}/runs/{rid}/forks").json()["runs"]])
tid = httpx.get(f"{B}/runs/{rid}").json()["task_id"]
print("\nCOMPARE:", [(r["session_name"], r["id"][:8], r["composite_score"], float(r["total_cost"])) for r in httpx.post(f"{B}/compare", json={"task_id": tid}).json()["ranked"]])
