"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api, fmt$, fmtMs, type CompareRow, type Task } from "@/lib/api";

const W = ["quality", "tests", "human", "cost", "speed", "effort"] as const;
const DEF: Record<string, number> = { quality: 1, tests: 1, human: 0.5, cost: 0.3, speed: 0.2, effort: 0.2 };

function Compare() {
  const sp = useSearchParams(); const [tasks, setTasks] = useState<Task[]>([]); const [taskId, setTaskId] = useState(sp.get("task") ?? "");
  const [rows, setRows] = useState<CompareRow[]>([]); const [w, setW] = useState(DEF); const [busy, setBusy] = useState(false);
  useEffect(() => { api.tasks().then(t => { setTasks(t); if (!taskId && t[0]) setTaskId(t[0].id); }); }, []); // eslint-disable-line
  const load = async (weights?: Record<string, number>) => { if (!taskId) return; setBusy(true); try { setRows((await api.compare(taskId, weights)).ranked); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [taskId]); // eslint-disable-line
  const best = rows[0];
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="flex gap-3 items-center flex-wrap"><h1 className="font-semibold text-lg">Which squad wins?</h1>
        <select className="border rounded px-2 py-1" value={taskId} onChange={e => setTaskId(e.target.value)}>{tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
        {busy && <span className="text-xs text-gray-500">re-scoring…</span>}</div>
      <div className="mt-3 grid grid-cols-3 md:grid-cols-6 gap-3 text-xs">{W.map(k => <label key={k}>{k} <b>{w[k]}</b><input type="range" min={0} max={2} step={0.1} value={w[k]} className="w-full" onChange={e => setW({ ...w, [k]: Number(e.target.value) })} onMouseUp={() => load(w)} onTouchEnd={() => load(w)} /></label>)}</div>
      {best && <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-sm">🏆 <b>{best.session_name}</b> leads with score {best.composite_score} at {fmt$(best.total_cost)} / run · {best.completion_status}</div>}
      <table className="mt-4 w-full text-sm border rounded"><thead className="bg-gray-50 text-left text-xs"><tr><th className="p-2">#</th><th>Squad</th><th>Score</th><th>Status</th><th>Judge</th><th>Tests</th><th>Human</th><th>Interventions</th><th>Cost</th><th>Time</th><th></th></tr></thead>
        <tbody>{rows.map((r, i) => <tr key={r.id} className={`border-t ${i === 0 ? "bg-green-50/40" : ""}`}><td className="p-2">{i + 1}</td><td>{r.session_name}{r.forked_from_node && <span className="ml-1 text-[10px] text-amber-700">fork@{r.forked_from_node}</span>}</td>
          <td><b>{r.composite_score ?? "—"}</b></td><td>{r.completion_status ?? "not evaluated"}</td><td>{r.final_judge_score ?? "—"}</td><td>{r.test_pass_rate != null ? `${Math.round(r.test_pass_rate * 100)}%` : "—"}</td><td>{r.human_score ?? "—"}</td><td>{r.interventions_count ?? 0}</td>
          <td>{fmt$(r.total_cost)}</td><td>{fmtMs(r.total_latency_ms)}</td><td><a className="text-indigo-700" href={`/runs/${r.id}`}>open</a></td></tr>)}
          {rows.length === 0 && <tr><td colSpan={11} className="p-3 text-gray-400">No finished runs for this task yet. Run the same task on 2+ squads from the Builder, then run the judge on each.</td></tr>}</tbody></table>
      <p className="mt-3 text-xs text-gray-500">score = quality·judge + tests·pass_rate + human·rating − cost·$ − speed·minutes − effort·interventions. Drag a slider and release to re-rank.</p>
    </main>
  );
}
export default function Page() { return <Suspense><Compare /></Suspense>; }
