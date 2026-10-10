"""Seed demo tasks + three contrasting squads. Usage: python demo/seed.py (server running)"""
import json, httpx
from pathlib import Path
B = "http://localhost:8000"
for f in sorted(Path(__file__).parent.glob("tasks/*.json")):
    t = httpx.post(f"{B}/tasks", json=json.loads(f.read_text())).json(); print("task:", t["title"], t["id"])
def llm(id, role, model, label=None, x=0): return {"id": id, "kind": "llm", "role": role, "model": model, "label": label or role.title(), "position": {"x": x, "y": 120}}
E = lambda i, s, t, **k: {"id": i, "source": s, "target": t, "type": "text", **k}
H, S, O = "anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5"
squads = {
  "All-Haiku (cheap baseline)": {"nodes": [llm("p","planner",H,x=40), llm("e","executor",H,x=320), llm("r","reviewer",H,x=600)], "edges": [E("1","p","e"), E("2","e","r"), E("b","r","e",max_loops=1)]},
  "Cheap executor, strong reviewer": {"nodes": [llm("p","planner",S,x=40), llm("e","executor",H,x=320), llm("r","reviewer",O,x=600)], "edges": [E("1","p","e"), E("2","e","r"), E("b","r","e",max_loops=2)]},
  "All-Sonnet with checkpoint": {"nodes": [llm("p","planner",S,x=40), {"id":"c","kind":"checkpoint","label":"Approve plan","position":{"x":320,"y":120},"params":{"timeout_minutes":30,"on_timeout":"approve"}}, llm("e","executor",S,x=600), llm("r","reviewer",S,x=880)],
     "edges": [E("1","p","c"), E("2","c","e"), E("3","e","r"), E("b","r","e",max_loops=1)]},
}
for name, g in squads.items():
    s = httpx.post(f"{B}/sessions", json={"name": name, "graph": g}).json(); print("squad:", name, s["id"])
print("Open http://localhost:3000 — run each squad on the same task, judge them, then Compare.")
