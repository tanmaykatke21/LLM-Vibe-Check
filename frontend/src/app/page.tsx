"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, fmt$, fmtMs, type Run, type Session, type Task } from "@/lib/api";

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [runs, setRuns] = useState<Run[]>([]);
  const [health, setHealth] = useState("…");
  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/health`).then(r => r.json()).then(d => setHealth(d.status)).catch(() => setHealth("DOWN"));
    api.sessions().then(setSessions).catch(() => {}); api.tasks().then(setTasks).catch(() => {}); api.runs().then(setRuns).catch(() => {});
  }, []);
  const badge = (s: string) => <span className={`px-2 py-0.5 rounded text-xs ${s === "done" ? "bg-green-100 text-green-800" : s === "failed" ? "bg-red-100 text-red-800" : s === "paused" ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"}`}>{s}</span>;
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <div className="text-xs text-gray-500 mb-4">Backend: <b className={health === "ok" ? "text-green-700" : "text-red-700"}>{health}</b></div>
      <div className="grid md:grid-cols-2 gap-6">
        <section><div className="flex justify-between items-baseline"><h2 className="font-semibold">Squads (sessions)</h2><Link href="/builder" className="text-sm text-indigo-700">+ New squad</Link></div>
          <ul className="mt-2 divide-y border rounded">{sessions.map(s => <li key={s.id} className="p-2 text-sm flex justify-between"><Link href={`/builder?session=${s.id}`} className="hover:underline">{s.name}</Link><span className="text-gray-400 text-xs">{s.graph.nodes.length} nodes</span></li>)}
            {sessions.length === 0 && <li className="p-2 text-sm text-gray-400">none yet</li>}</ul></section>
        <section><h2 className="font-semibold">Tasks</h2>
          <ul className="mt-2 divide-y border rounded">{tasks.map(t => <li key={t.id} className="p-2 text-sm flex justify-between"><span>{t.title}</span><Link href={`/compare?task=${t.id}`} className="text-xs text-indigo-700">compare runs</Link></li>)}
            {tasks.length === 0 && <li className="p-2 text-sm text-gray-400">none yet — create one in the Builder</li>}</ul></section>
      </div>
      <section className="mt-8"><h2 className="font-semibold">Recent runs</h2>
        <table className="mt-2 w-full text-sm border rounded"><thead className="bg-gray-50 text-left text-xs"><tr><th className="p-2">Squad</th><th>Task</th><th>Status</th><th>Cost</th><th>Time</th><th>Tokens</th><th></th></tr></thead>
          <tbody>{runs.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.session_name}{r.forked_from_node && <span className="ml-1 text-[10px] text-amber-700">fork@{r.forked_from_node}</span>}</td><td>{r.task_title}</td><td>{badge(r.status)}</td>
            <td>{fmt$(r.total_cost)}</td><td>{fmtMs(r.total_latency_ms)}</td><td>{r.total_input_tokens}+{r.total_output_tokens}</td><td><Link href={`/runs/${r.id}`} className="text-indigo-700">open</Link></td></tr>)}
            {runs.length === 0 && <tr><td className="p-2 text-gray-400" colSpan={7}>no runs yet</td></tr>}</tbody></table></section>
    </main>
  );
}
