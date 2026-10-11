"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SquadCanvas from "@/components/SquadCanvas";
import { ResizeHandle, useStoredSize } from "@/components/Resizable";
import { api, API, fmt$, fmtMs, type Run, type NodeResult, type Message, type Metrics, type EvalData, type ForkRow } from "@/lib/api";

type Ev = { type: string; node_id?: string; loop_index?: number; output?: string; error?: string; result?: Record<string, unknown> };

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const router = useRouter();
  const [run, setRun] = useState<Run | null>(null); const [nodes, setNodes] = useState<NodeResult[]>([]); const [msgs, setMsgs] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null); const [evalData, setEvalData] = useState<EvalData | null>(null); const [forks, setForks] = useState<ForkRow[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({}); const [waiting, setWaiting] = useState<{ node: string; output: string } | null>(null);
  const [edit, setEdit] = useState(""); const [note, setNote] = useState(""); const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<"trace" | "analytics" | "eval">("trace");
  const [fb, setFb] = useState({ rating: 4, complete: true, feedback_text: "" });
  const [panelW, setPanelW] = useStoredSize("run.panelW", 440, 280, 1100);
  const [outH, setOutH] = useStoredSize("run.outputH", 220, 60, 900); const [busy, setBusy] = useState(""); const [forkModel, setForkModel] = useState("");

  const reload = async () => {
    const [r, n, m] = await Promise.all([api.run(id), api.nodes(id), api.messages(id)]); setRun(r); setNodes(n); setMsgs(m);
    const st: Record<string, string> = {}; n.forEach(x => st[x.node_id] = x.reused_from_run_id ? "reused" : x.status === "error" ? "error" : "done"); setStatus(s => ({ ...s, ...st }));
    if (r.status === "done" || r.status === "failed") { api.metrics(id).then(setMetrics).catch(() => {}); api.evaluation(id).then(setEvalData).catch(() => {}); api.forks(id).then(f => setForks(f.runs)).catch(() => {}); }
  };
  useEffect(() => { reload(); const es = api.stream(id);
    const on = (t: string) => es.addEventListener(t, (e) => { const ev: Ev = JSON.parse((e as MessageEvent).data);
      if (t === "node_start") setStatus(s => ({ ...s, [ev.node_id!]: "running" }));
      if (t === "node_done") setStatus(s => ({ ...s, [ev.node_id!]: (ev.result?.status === "error") ? "error" : "done" }));
      if (t === "checkpoint_waiting") { setStatus(s => ({ ...s, [ev.node_id!]: "waiting" })); setWaiting({ node: ev.node_id!, output: ev.output ?? "" }); setEdit(ev.output ?? ""); }
      if (t === "checkpoint_decided") setWaiting(null);
      if (t === "node_done" || t === "message" || t === "loop") reload();
      if (t === "run_done" || t === "run_failed" || t === "done" || t === "failed") { reload(); es.close(); } });
    ["node_start", "node_done", "message", "loop", "checkpoint_waiting", "checkpoint_decided", "run_done", "run_failed", "done", "failed"].forEach(on);
    return () => es.close(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const metric = useMemo(() => { const m: Record<string, string> = {}; metrics?.nodes.forEach(n => m[n.node_id] = `${fmt$(n.cost_usd)} · ${fmtMs(n.latency_ms)} · ${n.input_tokens}+${n.output_tokens} tok`); return m; }, [metrics]);
  const judgeFor = (nid: string | null) => evalData?.judge.find(j => (j.node_id ?? null) === nid);
  const panelFor = (nid: string | null) => (evalData?.judge_panel ?? []).filter(j => (j.node_id ?? null) === nid);
  const shortM = (m?: string) => (m ?? "").split("/").pop() ?? "";
  const perJudge = (nid: string | null) => panelFor(nid).length > 1 ? panelFor(nid).map(p => `${shortM(p.judge_model)} ${p.accuracy_score}`).join(" · ") : "";
  const decide = async (action: string) => { await api.decide(id, waiting!.node, { action, edited_output: action === "edit" ? edit : undefined, note }); setWaiting(null); };
  const evaluate = async () => { setBusy("judging…"); try { await api.evaluate(id); await reload(); setTab("eval"); } finally { setBusy(""); } };
  const sendFb = async () => { setBusy("parsing feedback…"); try { await api.feedback(id, fb); await reload(); } finally { setBusy(""); } };
  const doFork = async () => { if (!sel) return; setBusy("forking…"); try { const r = await api.fork(id, sel, forkModel ? { [sel]: { model: forkModel } } : {}); router.push(`/runs/${r.id}`); } finally { setBusy(""); } };
  const selNodes = nodes.filter(n => n.node_id === sel);
  const g = run?.graph_snapshot;

  return (
    <main className="h-[calc(100vh-41px)] flex overflow-hidden">
      <div className="flex flex-col flex-1 min-w-0">
        <div className="p-2 border-b text-sm flex gap-3 items-center flex-wrap">
          <b>{run?.session_name}</b><span className="text-gray-500">{run?.task_title}</span>
          <span className={`px-2 rounded text-xs ${run?.status === "done" ? "bg-green-100" : run?.status === "failed" ? "bg-red-100" : run?.status === "paused" ? "bg-amber-100" : "bg-blue-100"}`}>{run?.status}</span>
          {run?.forked_from_node && <span className="text-xs text-amber-700">fork from {run.forked_from_node}</span>}
          {run?.status === "done" && <span className="text-xs">{fmt$(run.total_cost)} · {fmtMs(run.total_latency_ms)} · {run.total_input_tokens}+{run.total_output_tokens} tok</span>}
          <span className="ml-auto flex gap-2">{run?.status === "done" && <button onClick={evaluate} className="border rounded px-2 py-1 text-xs">⚖ Run LLM judge</button>}{busy && <span className="text-xs text-gray-500">{busy}</span>}</span>
        </div>
        {run?.error && <div className="bg-red-50 text-red-800 text-xs px-3 py-1">{run.error}</div>}
        {waiting && <div className="bg-amber-50 border-b border-amber-300 p-3 text-sm">
          <b>⏸ Checkpoint “{g?.nodes.find(n => n.id === waiting.node)?.label ?? waiting.node}” is waiting for you</b>
          <textarea className="mt-2 w-full border rounded p-2 text-xs font-mono" rows={6} value={edit} onChange={e => setEdit(e.target.value)} />
          <input className="mt-1 w-full border rounded px-2 py-1 text-xs" placeholder="note (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="flex gap-2 mt-2"><button onClick={() => decide("approve")} className="bg-green-600 text-white rounded px-3 py-1">Approve</button>
            <button onClick={() => decide("edit")} className="bg-blue-600 text-white rounded px-3 py-1">Approve with edits</button>
            <button onClick={() => decide("reject")} className="bg-red-600 text-white rounded px-3 py-1">Reject (stop)</button></div></div>}
        <div className="flex-1 min-h-[120px]">{g && <SquadCanvas graph={g} readOnly status={status} metric={metric} onSelect={setSel} />}</div>
        {run?.final_output && <>
          <ResizeHandle axis="y" size={outH} onResize={setOutH} reset={220} label="Final output height" />
          <div className="p-3 overflow-auto shrink-0" style={{ height: outH }}>
            <div className="text-xs text-gray-500 mb-1 flex justify-between"><span>FINAL OUTPUT</span>
              <span className="flex gap-2"><button className="underline" onClick={() => setOutH(60)}>min</button><button className="underline" onClick={() => setOutH(600)}>max</button></span></div>
            <pre className="text-xs whitespace-pre-wrap">{run.final_output}</pre></div></>}
      </div>
      <ResizeHandle axis="x" size={panelW} onResize={setPanelW} reset={440} label="Side panel width" />
      <aside className="overflow-y-auto text-sm shrink-0" style={{ width: panelW }}>
        <div className="flex border-b text-xs">{(["trace", "analytics", "eval"] as const).map(t => <button key={t} onClick={() => setTab(t)} className={`px-3 py-2 ${tab === t ? "border-b-2 border-black font-semibold" : "text-gray-500"}`}>{t}</button>)}</div>
        {tab === "trace" && <div className="p-3">
          {sel ? <>
            <div className="flex justify-between items-center"><b>{g?.nodes.find(n => n.id === sel)?.label ?? sel}</b>
              {run?.status === "done" && <span className="flex gap-1 items-center"><input list="fm" placeholder="new model (optional)" className="border rounded px-1 text-xs w-40" value={forkModel} onChange={e => setForkModel(e.target.value)} /><datalist id="fm">{["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1"].map(m => <option key={m} value={m} />)}</datalist>
                <button onClick={doFork} className="border rounded px-2 py-1 text-xs bg-amber-50">⑂ Fork from here</button></span>}</div>
            {judgeFor(sel) && <div className="mt-2 p-2 bg-orange-50 rounded text-xs"><b>{panelFor(sel).length > 1 ? "Judge panel" : "Judge"}:</b> {judgeFor(sel)!.accuracy_score}/10 · did its job: {String(judgeFor(sel)!.did_its_job)}{perJudge(sel) && <span className="text-gray-500"> · {perJudge(sel)}</span>}<div className="text-gray-600">{(judgeFor(sel)!.issues ?? []).join(" · ")}</div></div>}
            {selNodes.map((n, i) => <div key={i} className="mt-3 border rounded"><div className="bg-gray-50 px-2 py-1 text-xs flex justify-between"><span>attempt {n.loop_index} · {n.model_or_tool}{n.reused_from_run_id && " · reused"}</span><span>{n.input_tokens}+{n.output_tokens} tok · {fmt$(n.cost_usd)} · {fmtMs(n.latency_ms)}</span></div>
              {n.error && <div className="text-red-700 text-xs p-2">{n.error}</div>}
              <details className="p-2 text-xs"><summary className="cursor-pointer text-gray-600">input prompt</summary><pre className="whitespace-pre-wrap mt-1 max-h-[40vh] overflow-auto">{n.input}</pre></details>
              <div className="p-2 text-xs"><div className="text-gray-600">output</div>{n.output_kind === "audio" ? <audio controls src={`${API}/audio/${n.audio_path?.split("/").pop()}`} className="w-full mt-1" /> : <pre className="whitespace-pre-wrap mt-1 max-h-[60vh] overflow-auto">{n.output}</pre>}</div></div>)}
          </> : <div className="text-gray-500 text-xs">Click a node to see its prompt, output, metrics and judge verdict.</div>}
          <div className="mt-4"><b className="text-xs">Communication history</b>
            <ol className="mt-1 text-xs space-y-1">{msgs.map(m => <li key={m.seq} className="flex gap-2"><span className="text-gray-400 w-5">{m.seq}</span><span><b>{m.from_node}</b> → <b>{m.to_node}</b> <span className="text-gray-400">({m.kind})</span></span></li>)}</ol></div>
        </div>}
        {tab === "analytics" && <div className="p-3">{!metrics ? <div className="text-gray-500 text-xs">available when the run finishes</div> : <>
          <table className="w-full text-xs"><thead className="text-left text-gray-500"><tr><th>node</th><th>model</th><th>tok</th><th>cost</th><th>time</th></tr></thead>
            <tbody>{metrics.nodes.map(n => <tr key={n.node_id} className="border-t"><td className="py-1">{n.node_id}<div className="text-gray-400">{n.role ?? n.node_kind}{n.reused && " · reused"}</div></td><td className="truncate max-w-[120px]" title={n.model_or_tool}>{n.model_or_tool}</td><td>{n.input_tokens}+{n.output_tokens}</td>
              <td>{fmt$(n.cost_usd)}<div className="h-1 bg-indigo-200 rounded" style={{ width: `${n.cost_share * 100}%` }} /><span className="text-gray-400">{Math.round(n.cost_share * 100)}%</span></td>
              <td>{fmtMs(n.latency_ms)}<div className="h-1 bg-emerald-200 rounded" style={{ width: `${n.time_share * 100}%` }} /><span className="text-gray-400">{Math.round(n.time_share * 100)}%</span></td></tr>)}</tbody></table>
          <div className="mt-3 text-xs space-y-1"><div>Total cost <b>{fmt$(metrics.totals.cost_usd)}</b> · judge cost {fmt$(metrics.totals.judge_cost_usd)} (separate)</div>
            <div>Wall clock <b>{fmtMs(metrics.totals.wall_clock_ms)}</b> · sum of node time {fmtMs(metrics.totals.sum_node_latency_ms)} · human wait {fmtMs(metrics.totals.human_wait_ms)}</div>
            <div>Tokens {metrics.totals.input_tokens} in / {metrics.totals.output_tokens} out</div>
            <div>Projected: <b>${metrics.projection.per_1k_runs_usd}</b> per 1,000 runs</div></div>
          {forks.length > 1 && <div className="mt-4"><b className="text-xs">Fork tree</b><ul className="text-xs mt-1">{forks.map(f => <li key={f.id} style={{ paddingLeft: f.depth * 12 }}>{f.id === id ? "● " : "○ "}<a className="text-indigo-700" href={`/runs/${f.id}`}>{f.id.slice(0, 8)}</a>{f.forked_from_node && ` fork@${f.forked_from_node}`} · {fmt$(f.total_cost)}{f.composite_score != null && ` · quality ${Number(f.composite_score).toFixed(0)}/100`}</li>)}</ul></div>}
        </>}</div>}
        {tab === "eval" && <div className="p-3 text-xs">
          {evalData?.evaluation ? <div className="p-2 rounded bg-gray-50"><b className="text-sm">{evalData.evaluation.completion_status?.toUpperCase()}</b> — {evalData.evaluation.completion_reason}<div>quality score <b>{evalData.evaluation.composite_score ?? "—"}/100</b> <span className="text-gray-500">(overall rank, which also weighs cost and speed, is on Compare)</span>{evalData.evaluation.test_pass_rate != null && ` · tests ${Math.round(evalData.evaluation.test_pass_rate * 100)}%`}</div></div>
            : <div className="text-gray-500">No evaluation yet. {run?.status === "done" ? "Click “Run LLM judge” above or leave feedback below." : "Wait for the run to finish."}</div>}
          {(() => {
            const f = judgeFor(null); if (!f) return null;
            const per = panelFor(null);
            const sc = per.map(p => Number(p.accuracy_score)).filter(x => !Number.isNaN(x));
            const spread = sc.length > 1 ? Math.max(...sc) - Math.min(...sc) : 0;
            return <div className="mt-3 p-2 rounded bg-orange-50">
              <div className="flex flex-wrap items-baseline gap-2">
                <b>{per.length > 1 ? `Judge panel (${per.length} models) · final output:` : "LLM judge · final output:"}</b>
                <span className="text-sm font-semibold">{f.accuracy_score}/10</span><span>complete: {String(f.complete)}</span>
                {per.length > 1 && <span className={spread >= 3 ? "text-red-700 font-medium" : "text-gray-600"}>{spread >= 3 ? "⚠ judges disagree" : "✓ judges agree"} (spread {spread.toFixed(1)})</span>}
              </div>
              {per.length > 1 ? <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">{per.map(p => (
                <div key={p.judge_model} className="rounded border bg-white p-2 min-w-0 break-words">
                  <div className="flex justify-between"><span className="font-medium">{shortM(p.judge_model)}</span><b>{p.accuracy_score}/10</b></div>
                  <div className="text-gray-500">complete: {String(p.complete)}</div>
                  <div className="mt-1 text-gray-700">{p.rationale}</div>
                </div>))}</div>
                : <div className="text-gray-700 mt-1">{f.rationale}</div>}
              {(f.issues ?? []).length > 0 && <div className="mt-1">missing: {(f.issues ?? []).join(" · ")}</div>}
            </div>;
          })()}
          {evalData?.judge.filter(j => j.node_id).map(j => <div key={j.node_id} className="mt-1 flex gap-2"><span className="w-16 font-mono">{j.node_id}</span><span>{j.accuracy_score}/10</span><span className={j.did_its_job ? "text-green-700" : "text-red-700"}>{j.did_its_job ? "did its job" : "did NOT do its job"}</span>{perJudge(j.node_id ?? null) && <span className="text-gray-500">{perJudge(j.node_id ?? null)}</span>}</div>)}
          <div className="mt-4 border-t pt-3"><b>Human judge</b>
            <div className="flex gap-2 items-center mt-1">rating {[1, 2, 3, 4, 5].map(r => <button key={r} onClick={() => setFb({ ...fb, rating: r })} className={`w-7 h-7 rounded border ${fb.rating >= r ? "bg-yellow-300" : ""}`}>★</button>)}
              <label className="ml-2 flex gap-1 items-center"><input type="checkbox" checked={fb.complete} onChange={e => setFb({ ...fb, complete: e.target.checked })} />complete</label></div>
            <textarea className="mt-2 w-full border rounded p-2" rows={3} placeholder="What's right or wrong? Which role failed?" value={fb.feedback_text} onChange={e => setFb({ ...fb, feedback_text: e.target.value })} />
            <button onClick={sendFb} disabled={run?.status !== "done"} className="mt-1 border rounded px-3 py-1 disabled:opacity-40">Submit feedback</button>
            {evalData?.human.map((h, i) => <div key={i} className="mt-2 p-2 bg-blue-50 rounded">★{h.rating} “{h.feedback_text}”<div className="text-gray-600">feedback quality: <b>{h.feedback_quality}</b> · agrees with judge: {String(h.agrees_with_judge)} · blamed: {String((h.parsed_verdict as Record<string, unknown>)?.blamed_nodes ?? [])}</div></div>)}
          </div>
        </div>}
      </aside>
    </main>
  );
}
