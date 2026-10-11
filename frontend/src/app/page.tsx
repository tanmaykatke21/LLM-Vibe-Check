"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Empty, ModelChip, Panel, StatusPill } from "@/components/ui";
import { api, API, fmt$, fmtMs, type Run, type Session, type Task } from "@/lib/api";

const STEPS = [
  ["Build a squad", "Wire models from any company into roles: planner, builder, reviewer, or your own.", "/builder", "Open the builder"],
  ["Run it on a task", "Every step's prompt, answer, cost and time is recorded as it happens.", "/builder", "Pick a task"],
  ["Compare squads", "Hidden tests and a panel of judges from three companies score each run.", "/compare", "See the leaderboard"],
] as const;

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [runs, setRuns] = useState<Run[]>([]);
  const [health, setHealth] = useState<"ok" | "degraded" | "down" | "">(""); const [err, setErr] = useState("");
  const load = () => {
    fetch(`${API}/health`).then(r => r.json()).then(d => setHealth(d.status === "ok" ? "ok" : "degraded")).catch(() => setHealth("down"));
    api.sessions().then(setSessions).catch(() => {}); api.tasks().then(setTasks).catch(() => {}); api.runs().then(setRuns).catch(() => {});
  };
  useEffect(load, []);
  const runsBy = useMemo(() => { const s: Record<string, number> = {}, t: Record<string, number> = {};
    runs.forEach(r => { s[r.session_id] = (s[r.session_id] ?? 0) + 1; t[r.task_id] = (t[r.task_id] ?? 0) + 1; }); return { s, t }; }, [runs]);
  const spend = runs.reduce((a, r) => a + Number(r.total_cost || 0), 0);
  const del = async (fn: () => Promise<unknown>) => { setErr(""); try { await fn(); load(); } catch (e) { setErr(String((e as Error).message)); } };
  const modelsOf = (s: Session) => [...new Set(s.graph.nodes.filter(n => n.kind !== "checkpoint").map(n => n.model ?? n.tool ?? ""))];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <section className="grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-end">
        <div>
          <h1 className="text-[34px] font-semibold leading-[1.1] tracking-tight">Which AI team should do this job?</h1>
          <p className="mt-3 max-w-xl text-[15px] text-muted">Put models from different companies into roles, run them on the same task, and see which team gets it right for the least money and time.</p>
          <div className="mt-5 flex gap-2"><Link href="/builder"><Button variant="primary">Build a squad</Button></Link><Link href="/compare"><Button>Compare results</Button></Link></div>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
          {[["Runs", String(runs.length)], ["Squads", String(sessions.length)], ["Tasks", String(tasks.length)], ["Spent on models", `$${spend.toFixed(2)}`]].map(([k, v]) => (
            <div key={k} className="bg-surface px-4 py-3"><dt className="text-[12px] text-muted">{k}</dt><dd className="mt-0.5 font-mono text-[22px] text-ink">{v}</dd></div>))}
        </dl>
      </section>

      <ol className="mt-8 grid gap-3 md:grid-cols-3">
        {STEPS.map(([t, d, href, cta], i) => (
          <li key={t} className="rounded-xl border border-line bg-surface p-4">
            <div className="flex items-center gap-2"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent">{i + 1}</span><h2 className="font-semibold">{t}</h2></div>
            <p className="mt-2 text-[13px] text-muted">{d}</p>
            <Link href={href} className="mt-2 inline-block text-[13px] font-medium text-accent hover:underline">{cta}</Link>
          </li>))}
      </ol>

      {health && health !== "ok" && <p role="alert" className="mt-6 rounded-lg bg-bad-soft px-3 py-2 text-[13px] text-bad">
        {health === "down" ? "The backend isn't reachable. Start it with uvicorn on port 8000." : "The backend is up but the database isn't. Run: docker start squad-db"}</p>}
      {err && <p role="alert" className="mt-6 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">{err}</p>}

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">Squads</h2><Link href="/builder"><Button size="sm">New squad</Button></Link></div>
          {sessions.length === 0 ? <div className="p-4"><Empty title="No squads yet">Build your first one in the builder.</Empty></div> :
            <ul className="divide-y divide-line">{sessions.map(s => (
              <li key={s.id} className="group flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><Link href={`/builder?session=${s.id}`} className="block truncate font-medium hover:text-accent">{s.name}</Link>
                  <div className="mt-1 flex flex-wrap gap-1">{modelsOf(s).slice(0, 4).map(m => <ModelChip key={m} model={m} />)}</div></div>
                <span className="shrink-0 text-[12px] text-muted">{runsBy.s[s.id] ? `${runsBy.s[s.id]} run${runsBy.s[s.id] > 1 ? "s" : ""}` : "No runs"}</span>
                {!runsBy.s[s.id] && <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${s.name}`} onClick={() => del(() => api.deleteSession(s.id))}>Delete</Button>}
              </li>))}</ul>}
        </Panel>
        <Panel>
          <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="font-semibold">Tasks</h2><Link href="/builder"><Button size="sm">New task</Button></Link></div>
          {tasks.length === 0 ? <div className="p-4"><Empty title="No tasks yet">Create one from the builder&apos;s side panel.</Empty></div> :
            <ul className="divide-y divide-line">{tasks.map(t => (
              <li key={t.id} className="group flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{t.title}</div><div className="text-[12px] text-muted">{t.task_type.charAt(0).toUpperCase() + t.task_type.slice(1)}{t.test_cases ? ", has hidden tests" : ""}</div></div>
                {runsBy.t[t.id] ? <Link href={`/compare?task=${t.id}`} className="shrink-0 text-[13px] font-medium text-accent hover:underline">Compare {runsBy.t[t.id]} run{runsBy.t[t.id] > 1 ? "s" : ""}</Link>
                  : <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete ${t.title}`} onClick={() => del(() => api.deleteTask(t.id))}>Delete</Button>}
              </li>))}</ul>}
        </Panel>
      </div>

      <Panel className="mt-6 overflow-hidden">
        <div className="border-b border-line px-4 py-3"><h2 className="font-semibold">Recent runs</h2></div>
        {runs.length === 0 ? <div className="p-4"><Empty title="Nothing has run yet">Open a squad in the builder, pick a task and choose Run squad.</Empty></div> :
          <div className="overflow-x-auto"><table className="w-full text-[13px]">
            <thead className="bg-paper text-left text-[12px] text-muted"><tr><th className="px-4 py-2 font-medium">Squad</th><th className="px-2 font-medium">Task</th><th className="px-2 font-medium">Status</th><th className="px-2 text-right font-medium">Cost</th><th className="px-2 text-right font-medium">Time</th><th className="px-4 text-right font-medium">Tokens</th></tr></thead>
            <tbody className="divide-y divide-line">{runs.slice(0, 15).map(r => (
              <tr key={r.id} className="hover:bg-paper">
                <td className="px-4 py-2"><Link href={`/runs/${r.id}`} className="font-medium hover:text-accent">{r.session_name}</Link>{r.forked_from_node && <span className="ml-2 rounded-full bg-warn-soft px-1.5 text-[11px] text-warn">fork</span>}</td>
                <td className="max-w-[260px] truncate px-2 text-muted">{r.task_title}</td><td className="px-2"><StatusPill status={r.status} /></td>
                <td className="px-2 text-right font-mono">{fmt$(r.total_cost)}</td><td className="px-2 text-right font-mono">{fmtMs(r.total_latency_ms)}</td>
                <td className="px-4 text-right font-mono text-muted">{r.total_input_tokens + r.total_output_tokens}</td></tr>))}</tbody></table></div>}
      </Panel>
    </main>
  );
}

