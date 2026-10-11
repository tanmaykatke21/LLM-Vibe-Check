"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import SquadCanvas from "@/components/SquadCanvas";
import { ResizeHandle, useStoredSize } from "@/components/Resizable";
import { Button, CopyButton, ModelChip, OutputText, StatusPill } from "@/components/ui";
import { providerOf, shortModel } from "@/lib/providers";
import { api, API, fmt$, fmtMs, type Run, type NodeResult, type Message, type Metrics, type EvalData, type ForkRow } from "@/lib/api";

type Ev = { type: string; node_id?: string; loop_index?: number; output?: string; error?: string; result?: Record<string, unknown> };
const TABS = [["trace", "Trace"], ["analytics", "Cost & time"], ["eval", "Evaluation"]] as const;

function Stat({ k, v }: { k: string; v: string }) {
  return <div className="leading-tight"><div className="text-[11px] text-muted">{k}</div><div className="font-mono text-[13px] text-ink">{v}</div></div>;
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const router = useRouter();
  const [run, setRun] = useState<Run | null>(null); const [nodes, setNodes] = useState<NodeResult[]>([]); const [msgs, setMsgs] = useState<Message[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null); const [evalData, setEvalData] = useState<EvalData | null>(null); const [forks, setForks] = useState<ForkRow[]>([]);
  const [status, setStatus] = useState<Record<string, string>>({}); const [waiting, setWaiting] = useState<{ node: string; output: string } | null>(null);
  const [edit, setEdit] = useState(""); const [note, setNote] = useState(""); const [sel, setSel] = useState<string | null>(null); const [tab, setTab] = useState<"trace" | "analytics" | "eval">("trace");
  const [fb, setFb] = useState({ rating: 4, complete: true, feedback_text: "" });
  const [panelW, setPanelW] = useStoredSize("run.panelW", 440, 280, 1100);
  const [outH, setOutH] = useStoredSize("run.outputH", 260, 60, 900); const [busy, setBusy] = useState(""); const [forkModel, setForkModel] = useState("");

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

  const metric = useMemo(() => { const m: Record<string, string> = {}; metrics?.nodes.forEach(n => m[n.node_id] = `${fmt$(n.cost_usd)}   ${fmtMs(n.latency_ms)}   ${n.input_tokens + n.output_tokens} tok`); return m; }, [metrics]);
  const judgeFor = (nid: string | null) => evalData?.judge.find(j => (j.node_id ?? null) === nid);
  const panelFor = (nid: string | null) => (evalData?.judge_panel ?? []).filter(j => (j.node_id ?? null) === nid);
  const decide = async (action: string) => { await api.decide(id, waiting!.node, { action, edited_output: action === "edit" ? edit : undefined, note }); setWaiting(null); };
  const evaluate = async () => { setBusy("Judging…"); try { await api.evaluate(id); await reload(); setTab("eval"); } finally { setBusy(""); } };
  const sendFb = async () => { setBusy("Reading your feedback…"); try { await api.feedback(id, fb); await reload(); } finally { setBusy(""); } };
  const doFork = async () => { if (!sel) return; setBusy("Forking…"); try { const r = await api.fork(id, sel, forkModel ? { [sel]: { model: forkModel } } : {}); router.push(`/runs/${r.id}`); } finally { setBusy(""); } };
  const selNodes = nodes.filter(n => n.node_id === sel);
  const g = run?.graph_snapshot;
  const label = (nid: string) => g?.nodes.find(n => n.id === nid)?.label || nid;
  const total = g?.nodes.length ?? 0;
  const finished = Object.values(status).filter(s => s === "done" || s === "reused" || s === "error").length;
  const live = run && (run.status === "running" || run.status === "queued" || run.status === "paused");

  return (
    <main className="flex h-[calc(100vh-3rem)] overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-surface px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="truncate text-[16px] font-semibold">{run?.session_name ?? "Loading run…"}</h1><StatusPill status={run?.status} />
                {run?.forked_from_node && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[11px] text-warn">Fork from {label(run.forked_from_node)}</span>}</div>
              <div className="truncate text-[12px] text-muted">{run?.task_title}</div>
            </div>
            {run?.status === "done" && <div className="flex gap-5"><Stat k="Cost" v={fmt$(run.total_cost)} /><Stat k="Time" v={fmtMs(run.total_latency_ms)} /><Stat k="Tokens" v={`${run.total_input_tokens} in / ${run.total_output_tokens} out`} /></div>}
            <div className="ml-auto flex items-center gap-2">{busy && <span className="text-[12px] text-muted">{busy}</span>}
              {run?.status === "done" && <Button variant="primary" onClick={evaluate} disabled={!!busy}>Judge this run</Button>}</div>
          </div>
          {live && total > 0 && <div className="mt-3 flex items-center gap-3 text-[11px] text-muted">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-paper"><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.min(100, finished / total * 100)}%` }} /></div>
            {finished} of {total} steps done</div>}
        </header>
        {run?.error && <div role="alert" className="border-b border-bad/20 bg-bad-soft px-4 py-2 text-[12px] text-bad">This run stopped: {run.error}</div>}
        {waiting && <div className="border-b border-warn/30 bg-warn-soft px-4 py-3">
          <div className="text-[13px] font-semibold text-warn">“{label(waiting.node)}” is waiting for your approval</div>
          <p className="text-[12px] text-muted">Approve it as is, edit it before it moves on, or stop the run.</p>
          <textarea className="field mt-2 font-mono text-[12px]" rows={6} value={edit} onChange={e => setEdit(e.target.value)} />
          <input className="field mt-2" placeholder="Note for the record (optional)" value={note} onChange={e => setNote(e.target.value)} />
          <div className="mt-2 flex gap-2"><Button variant="primary" onClick={() => decide("approve")}>Approve</Button>
            <Button onClick={() => decide("edit")}>Approve with my edits</Button>
            <Button variant="danger" onClick={() => decide("reject")}>Stop the run</Button></div></div>}
        <div className="min-h-[140px] flex-1">{g && <SquadCanvas graph={g} readOnly status={status} metric={metric} onSelect={setSel} />}</div>
        {run?.final_output && <>
          <ResizeHandle axis="y" size={outH} onResize={setOutH} reset={260} label="Final output height" />
          <section className="shrink-0 overflow-auto bg-surface px-4 py-3" style={{ height: outH }}>
            <div className="mb-2 flex items-center justify-between"><h2 className="text-[13px] font-semibold">Final output</h2>
              <div className="flex items-center gap-1"><CopyButton text={run.final_output} label="Copy all" />
                <Button size="sm" variant="ghost" onClick={() => setOutH(60)}>Collapse</Button><Button size="sm" variant="ghost" onClick={() => setOutH(600)}>Expand</Button></div></div>
            <OutputText text={run.final_output} /></section></>}
      </div>
      <ResizeHandle axis="x" size={panelW} onResize={setPanelW} reset={440} label="Side panel width" />
      <aside className="shrink-0 overflow-y-auto border-l border-line bg-surface" style={{ width: panelW }}>
        <div role="tablist" className="sticky top-0 z-10 flex gap-1 border-b border-line bg-surface px-3">
          {TABS.map(([t, l]) => <button role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}
            className={`border-b-2 px-2 py-2.5 text-[13px] ${tab === t ? "border-accent font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{l}</button>)}</div>

        {tab === "trace" && <div className="p-4">
          {sel ? <>
            <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-[15px] font-semibold">{label(sel)}</h2>
              {g?.nodes.find(n => n.id === sel)?.kind !== "checkpoint" && <ModelChip className="mt-1" model={g?.nodes.find(n => n.id === sel)?.model ?? g?.nodes.find(n => n.id === sel)?.tool} />}</div></div>
            {run?.status === "done" && <div className="mt-3 rounded-lg border border-line bg-paper p-3">
              <div className="text-[12px] font-medium">Try a different model from this step</div>
              <p className="text-[11px] text-muted">Earlier steps are reused for free; this step and everything after it re-runs.</p>
              <div className="mt-2 flex gap-2"><input list="fm" placeholder="Same model" className="field font-mono text-[12px]" value={forkModel} onChange={e => setForkModel(e.target.value)} />
                <datalist id="fm">{["anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "openai/gpt-5.4", "google/gemini-3.1-pro-preview"].map(m => <option key={m} value={m} />)}</datalist>
                <Button onClick={doFork}>Fork run</Button></div></div>}
            {judgeFor(sel) && <div className="mt-3 rounded-lg border border-line p-3 text-[12px]">
              <div className="flex items-center justify-between"><span className="font-medium">{panelFor(sel).length > 1 ? "Judge panel" : "Judge"}</span>
                <span><b className="text-[14px]">{judgeFor(sel)!.accuracy_score}</b><span className="text-muted">/10</span></span></div>
              <div className={judgeFor(sel)!.did_its_job ? "text-good" : "text-bad"}>{judgeFor(sel)!.did_its_job ? "Did its job" : "Did not do its job"}</div>
              {panelFor(sel).length > 1 && <div className="mt-1 flex flex-wrap gap-1">{panelFor(sel).map(p => <span key={p.judge_model} className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: providerOf(p.judge_model).soft, color: providerOf(p.judge_model).color }}>{shortModel(p.judge_model)} {p.accuracy_score}</span>)}</div>}
              {(judgeFor(sel)!.issues ?? []).length > 0 && <ul className="mt-2 list-disc pl-4 text-muted">{(judgeFor(sel)!.issues ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
            {selNodes.map((n, i) => <div key={i} className="mt-3 overflow-hidden rounded-lg border border-line">
              <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1.5 text-[11px] text-muted">
                <span className="font-medium text-ink">Attempt {n.loop_index + 1}{n.reused_from_run_id && " (reused)"}</span>
                <span className="font-mono">{n.input_tokens + n.output_tokens} tok   {fmt$(n.cost_usd)}   {fmtMs(n.latency_ms)}</span></div>
              {n.error && <div className="bg-bad-soft p-3 text-[12px] text-bad">{n.error}</div>}
              <details className="border-b border-line px-3 py-2 text-[12px]"><summary className="cursor-pointer text-muted">What it was asked</summary><pre className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap font-mono text-[11px]">{n.input}</pre></details>
              <div className="p-3">{n.output_kind === "audio" ? <audio controls src={`${API}/audio/${n.audio_path?.split("/").pop()}`} className="w-full" /> : <OutputText text={n.output ?? ""} />}</div></div>)}
          </> : <p className="text-[13px] text-muted">Click a step in the squad to see what it was asked, what it answered, its cost and the judges&apos; verdict.</p>}
          <div className="mt-6"><h3 className="text-[13px] font-semibold">Conversation</h3>
            {msgs.length === 0 ? <p className="mt-1 text-[12px] text-faint">No messages yet.</p> :
              <ol className="mt-2 space-y-1">{msgs.map(m => <li key={m.seq} className="flex items-center gap-2 text-[12px]">
                <span className="w-5 text-right font-mono text-faint">{m.seq}</span>
                <span className="font-medium">{label(m.from_node)}</span><span className="text-faint">to</span><span className="font-medium">{label(m.to_node)}</span>
                {m.kind === "audio" && <span className="rounded bg-paper px-1 text-[10px] text-muted">audio</span>}</li>)}</ol>}</div>
        </div>}

        {tab === "analytics" && <div className="p-4">{!metrics ? <p className="text-[13px] text-muted">Available when the run finishes.</p> : <>
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-line p-3">
            <Stat k="Total cost" v={fmt$(metrics.totals.cost_usd)} /><Stat k="Per 1,000 runs" v={`$${metrics.projection.per_1k_runs_usd}`} />
            <Stat k="Wall-clock time" v={fmtMs(metrics.totals.wall_clock_ms)} /><Stat k="Waiting for you" v={fmtMs(metrics.totals.human_wait_ms)} />
            <Stat k="Tokens in / out" v={`${metrics.totals.input_tokens} / ${metrics.totals.output_tokens}`} /><Stat k="Judging cost" v={fmt$(metrics.totals.judge_cost_usd)} /></div>
          <h3 className="mt-5 text-[13px] font-semibold">By step</h3>
          <div className="mt-2 space-y-3">{metrics.nodes.map(n => { const c = providerOf(n.model_or_tool).color; return (
            <div key={n.node_id} className="text-[12px]">
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{label(n.node_id)}{n.reused && <span className="ml-1 text-faint">(reused)</span>}</span><ModelChip model={n.model_or_tool} /></div>
              <div className="mt-1 grid grid-cols-[60px_1fr_70px] items-center gap-2 text-muted"><span>Cost</span><div className="h-2 rounded-full bg-paper"><div className="h-2 rounded-full" style={{ width: `${Math.max(n.cost_share * 100, 1)}%`, background: c }} /></div><span className="text-right font-mono">{Math.round(n.cost_share * 100)}%</span></div>
              <div className="mt-0.5 grid grid-cols-[60px_1fr_70px] items-center gap-2 text-muted"><span>Time</span><div className="h-2 rounded-full bg-paper"><div className="h-2 rounded-full opacity-60" style={{ width: `${Math.max(n.time_share * 100, 1)}%`, background: c }} /></div><span className="text-right font-mono">{fmtMs(n.latency_ms)}</span></div>
            </div>); })}</div>
          {forks.length > 1 && <div className="mt-6"><h3 className="text-[13px] font-semibold">Forks of this run</h3>
            <ul className="mt-2 space-y-1 text-[12px]">{forks.map(f => <li key={f.id} style={{ paddingLeft: f.depth * 14 }} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${f.id === id ? "bg-accent" : "bg-line-strong"}`} />
              <a className="font-mono text-accent hover:underline" href={`/runs/${f.id}`}>{f.id.slice(0, 8)}</a>
              {f.forked_from_node && <span className="text-muted">from {label(f.forked_from_node)}</span>}<span className="font-mono text-muted">{fmt$(f.total_cost)}</span>
              {f.composite_score != null && <span className="text-muted">quality {Number(f.composite_score).toFixed(0)}</span>}</li>)}</ul></div>}
        </>}</div>}

        {tab === "eval" && <div className="space-y-4 p-4 text-[12px]">
          {evalData?.evaluation ? <div className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between"><StatusPill status={evalData.evaluation.completion_status} />
              <span><b className="text-[18px]">{evalData.evaluation.composite_score ?? "—"}</b><span className="text-muted">/100 quality</span></span></div>
            <p className="mt-1 text-muted">{evalData.evaluation.completion_reason.replace(/^tests/, "Hidden tests")}. The overall ranking, which also weighs cost and speed, is on Compare.</p></div>
            : <div className="rounded-lg border border-dashed border-line-strong p-3 text-muted">Not judged yet. {run?.status === "done" ? "Choose Judge this run, or rate it yourself below." : "Wait for the run to finish."}</div>}
          {(() => {
            const f = judgeFor(null); if (!f) return null;
            const per = panelFor(null);
            const sc = per.map(p => Number(p.accuracy_score)).filter(x => !Number.isNaN(x));
            const spread = sc.length > 1 ? Math.max(...sc) - Math.min(...sc) : 0;
            return <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[13px] font-semibold">{per.length > 1 ? `Judge panel, ${per.length} models` : "Judge"}</h3>
                <span><b className="text-[15px]">{f.accuracy_score}</b><span className="text-muted">/10</span>
                  {per.length > 1 && <span className={`ml-2 ${spread >= 3 ? "font-medium text-bad" : "text-good"}`}>{spread >= 3 ? `Judges disagree by ${spread.toFixed(1)}` : `Judges agree within ${spread.toFixed(1)}`}</span>}</span></div>
              {per.length > 1 ? <div className="mt-2 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">{per.map(p => { const pv = providerOf(p.judge_model); return (
                <div key={p.judge_model} className="min-w-0 break-words rounded-lg border border-line p-3" style={{ borderTop: `3px solid ${pv.color}` }}>
                  <div className="flex items-center justify-between gap-2"><ModelChip className="min-w-0" model={p.judge_model} /><b className="shrink-0">{p.accuracy_score}/10</b></div>
                  <div className={`mt-1 ${p.complete ? "text-good" : "text-bad"}`}>{p.complete ? "Complete" : "Not complete"}</div>
                  <p className="mt-1 text-muted">{p.rationale}</p></div>); })}</div>
                : <p className="mt-1 text-muted">{f.rationale}</p>}
              {(f.issues ?? []).length > 0 && <div className="mt-2"><span className="font-medium">Missing</span><ul className="mt-1 list-disc pl-4 text-muted">{(f.issues ?? []).map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
            </div>;
          })()}
          {(evalData?.judge.filter(j => j.node_id).length ?? 0) > 0 && <div><h3 className="text-[13px] font-semibold">Each step</h3>
            <div className="mt-2 divide-y divide-line rounded-lg border border-line">{evalData!.judge.filter(j => j.node_id).map(j => (
              <div key={j.node_id} className="flex items-center gap-3 px-3 py-2">
                <span className="flex-1 truncate font-medium">{label(j.node_id!)}</span>
                <span className={j.did_its_job ? "text-good" : "text-bad"}>{j.did_its_job ? "Did its job" : "Did not"}</span>
                <span className="w-12 text-right font-mono">{j.accuracy_score}/10</span></div>))}</div></div>}
          <div className="border-t border-line pt-4"><h3 className="text-[13px] font-semibold">Your verdict</h3>
            <div className="mt-2 flex items-center gap-1">{[1, 2, 3, 4, 5].map(r => <button key={r} aria-label={`${r} stars`} onClick={() => setFb({ ...fb, rating: r })}
              className={`h-8 w-8 rounded-lg border text-[15px] ${fb.rating >= r ? "border-warn bg-warn-soft text-warn" : "border-line-strong text-faint"}`}>★</button>)}
              <label className="ml-3 flex items-center gap-1.5"><input type="checkbox" className="accent-[#4F46E5]" checked={fb.complete} onChange={e => setFb({ ...fb, complete: e.target.checked })} />Task is complete</label></div>
            <textarea className="field mt-2" rows={3} placeholder="What's right or wrong? Which step let it down?" value={fb.feedback_text} onChange={e => setFb({ ...fb, feedback_text: e.target.value })} />
            <Button className="mt-2" onClick={sendFb} disabled={run?.status !== "done" || !!busy}>Submit verdict</Button>
            {evalData?.human.map((h, i) => <div key={i} className="mt-3 rounded-lg border border-line p-3">
              <div><span className="text-warn">{"★".repeat(h.rating)}</span> <span className="text-ink">“{h.feedback_text}”</span></div>
              <div className="mt-1 text-muted">Feedback is <b>{h.feedback_quality}</b>{h.agrees_with_judge != null && `, ${h.agrees_with_judge ? "agrees" : "disagrees"} with the judges`}
                {((h.parsed_verdict as Record<string, unknown>)?.blamed_nodes as string[] | undefined)?.length ? `, blames ${((h.parsed_verdict as Record<string, unknown>).blamed_nodes as string[]).map(label).join(", ")}` : ""}</div></div>)}
          </div>
        </div>}
      </aside>
    </main>
  );
}

