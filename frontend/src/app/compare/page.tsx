"use client";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { api, type CompareRow, type CompareNode, type Task } from "@/lib/api";

/* Categorical slots (fixed order, validated palette). Color follows the squad, never its rank. */
const SLOTS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const OTHER = "#8a8984";

type Row = CompareRow & {
  label: string; color: string; quality: number | null; cost: number; time: number; tokens: number;
  value: number | null; per1k: number; tps: number | null;
  squadRuns: number; squadJudged: number; squadWins: number; squadAvgCost: number;
};
type RankKey = "overall" | "quality" | "cost" | "speed" | "value" | "tokens";
type Metric = { label: string; short: string; get: (r: Row) => number | null; better: "high" | "low"; fmt: (v: number) => string; hint: string };

const money = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toPrecision(2)}` : `$${v.toFixed(v < 1 ? 3 : 2)}`);
const secs = (ms: number) => (ms >= 60000 ? `${(ms / 60000).toFixed(1)}m` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const kfmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);
const shortModel = (m: string) => m.split("/").pop() ?? m;

const METRICS: Record<RankKey, Metric> = {
  overall: { label: "Overall", short: "Score", get: r => (r.composite_score == null ? null : Number(r.composite_score)), better: "high", fmt: v => `${v.toFixed(0)}/100`, hint: "Quality (judges, tests, human) out of 100, reduced for being pricier or slower than the best squad on this task" },
  quality: { label: "Quality", short: "Quality", get: r => r.quality, better: "high", fmt: v => `${v.toFixed(1)}/10`, hint: "LLM-judge accuracy of the final output (test pass rate if not judged)" },
  cost: { label: "Cheapest", short: "Cost / run", get: r => r.cost, better: "low", fmt: money, hint: "Total provider cost of one run" },
  speed: { label: "Fastest", short: "Time / run", get: r => r.time, better: "low", fmt: secs, hint: "Wall-clock time of one run" },
  value: { label: "Cheapest correct", short: "$ per correct answer", get: r => r.value, better: "low", fmt: money, hint: "What you pay on average to get one correct answer: average cost per run ÷ success rate (runs marked complete). Squads that never completed the task get no value." },
  tokens: { label: "Fewest tokens", short: "Tokens", get: r => r.tokens, better: "low", fmt: kfmt, hint: "Input + output tokens across every node" },
};

function rankBy(rows: Row[], m: Metric) {
  return [...rows].sort((a, b) => {
    const x = m.get(a), y = m.get(b);
    if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
    return m.better === "high" ? y - x : x - y;
  });
}

const W = ["quality", "tests", "human", "cost", "speed", "effort"] as const;
const DEF: Record<string, number> = { quality: 1, tests: 1, human: 0.5, cost: 0.2, speed: 0.1, effort: 0.1 };
const WLABEL: Record<string, string> = { quality: "Judge panel", tests: "Hidden tests", human: "Human rating", cost: "Cost penalty", speed: "Speed penalty", effort: "Help-needed penalty" };
const isPenalty = (k: string) => k === "cost" || k === "speed" || k === "effort";

type Tip = { x: number; y: number; body: ReactNode } | null;

function Compare() {
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskId, setTaskId] = useState(sp.get("task") ?? "");
  const [raw, setRaw] = useState<CompareRow[]>([]);
  const [w, setW] = useState(DEF);
  const [busy, setBusy] = useState(false);
  const [rank, setRank] = useState<RankKey>("overall");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [sel, setSel] = useState<string | null>(null);
  const [tip, setTip] = useState<Tip>(null);
  const [repeatMsg, setRepeatMsg] = useState("");

  useEffect(() => { api.tasks().then(t => { setTasks(t); if (!taskId && t[0]) setTaskId(t[0].id); }); }, []); // eslint-disable-line
  const load = async (weights?: Record<string, number>) => {
    if (!taskId) return; setBusy(true);
    try { setRaw((await api.compare(taskId, weights)).ranked); } finally { setBusy(false); }
  };
  useEffect(() => { setSel(null); setHidden(new Set()); load(); }, [taskId]); // eslint-disable-line

  /* Run a squad N more times; backend auto-judges each run. Poll until they show up judged. */
  const repeat = async (sessionId: string, name: string, n: number) => {
    setRepeatMsg(`Starting ${n} more runs of ${name}…`);
    try {
      const started = await api.repeat(sessionId, taskId, n);
      const ids = new Set(started.runs.map(x => x.id));
      setRepeatMsg(`${n} runs of ${name} started — each is judged automatically when it finishes (~1–2 min).`);
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 8000));
        const rows = (await api.compare(taskId)).ranked; setRaw(rows);
        const st = await Promise.all([...ids].map(id => api.run(id).then(x => x.status).catch(() => "failed")));
        const judged = rows.filter(x => ids.has(x.id) && x.completion_status).length;
        const finished = st.filter(x => x === "done" || x === "failed").length;
        const failed = st.filter(x => x === "failed").length;
        setRepeatMsg(`${name}: ${finished}/${n} finished, ${judged} judged${failed ? `, ${failed} failed` : ""}${st.includes("paused") ? " · a checkpoint is waiting for you on the run page" : ""}`);
        if (judged + failed >= n) { setRepeatMsg(`${name}: all ${n} extra runs done.`); break; }
      }
    } catch (e) { setRepeatMsg(`Could not start runs: ${String(e).slice(0, 200)}`); }
  };

  /* Derive rows; colors assigned by squad in order of first run, stable under filtering/ranking. */
  const all: Row[] = useMemo(() => {
    const byTime = [...raw].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const order: string[] = []; byTime.forEach(r => { if (!order.includes(r.session_id)) order.push(r.session_id); });
    const seen: Record<string, number> = {};
    const runNo: Record<string, number> = {};
    byTime.forEach(r => { seen[r.session_id] = (seen[r.session_id] ?? 0) + 1; runNo[r.id] = seen[r.session_id]; });
    const agg: Record<string, { runs: number; judged: number; wins: number; cost: number }> = {};
    raw.forEach(r => {
      const a = (agg[r.session_id] ??= { runs: 0, judged: 0, wins: 0, cost: 0 });
      a.runs++; a.cost += Number(r.total_cost ?? 0);
      if (r.completion_status) { a.judged++; if (r.completion_status === "complete") a.wins++; }
    });
    return raw.map(r => {
      const sq = agg[r.session_id];
      const avgCost = sq.cost / sq.runs, rate = sq.judged ? sq.wins / sq.judged : 0;
      const idx = order.indexOf(r.session_id);
      const cost = Number(r.total_cost ?? 0), time = Number(r.total_latency_ms ?? 0);
      const tokens = Number(r.total_input_tokens ?? 0) + Number(r.total_output_tokens ?? 0);
      const quality = r.final_judge_score != null ? Number(r.final_judge_score) : r.test_pass_rate != null ? Number(r.test_pass_rate) * 10 : null;
      const multi = seen[r.session_id] > 1;
      return {
        ...r, cost, time, tokens, quality,
        label: `${r.session_name}${r.forked_from_node ? ` ⑂${r.forked_from_node}` : ""}${multi ? ` #${runNo[r.id]}` : ""}`,
        color: idx < SLOTS.length ? SLOTS[idx] : OTHER,
        value: rate > 0 ? avgCost / rate : null,
        squadRuns: sq.runs, squadJudged: sq.judged, squadWins: sq.wins, squadAvgCost: avgCost,
        per1k: cost * 1000,
        tps: time > 0 ? Number(r.total_output_tokens ?? 0) / (time / 1000) : null,
      };
    });
  }, [raw]);
  const rows = all.filter(r => !hidden.has(r.id));
  const metric = METRICS[rank];
  const ranked = rankBy(rows, metric);
  const selected = all.find(r => r.id === sel) ?? ranked[0];

  const showTip = (e: React.MouseEvent, body: ReactNode) => setTip({ x: e.clientX, y: e.clientY, body });
  const hideTip = () => setTip(null);

  return (
    <main className="px-4 md:px-6 py-6 max-w-7xl mx-auto text-gray-900">
      {/* Header */}
      <div className="flex gap-3 items-end flex-wrap justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500">Squad showdown</p>
          <h1 className="text-2xl font-semibold">Which squad wins this task?</h1>
        </div>
        <div className="flex items-center gap-2">
          <select className="border rounded-md px-2 py-1.5 text-sm bg-white max-w-xs" value={taskId} onChange={e => setTaskId(e.target.value)}>
            {tasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
          <span className="text-xs text-gray-500">{all.length} run{all.length === 1 ? "" : "s"}{busy ? " · re-scoring…" : ""}</span>
        </div>
      </div>

      {all.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed p-10 text-center text-gray-500">
          No finished runs for this task yet. Run the same task on 2+ squads from the Builder, then click <b>Run judge</b> on each run.
        </div>
      ) : (<>
        {/* Legend doubles as filter */}
        <div className="mt-4 flex flex-wrap gap-2">
          {all.map(r => {
            const off = hidden.has(r.id);
            return (
              <button key={r.id} onClick={() => { const n = new Set(hidden); if (off) n.delete(r.id); else n.add(r.id); setHidden(n); }}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${off ? "opacity-40 line-through" : "bg-white"}`}
                title={off ? "Show this squad" : "Hide this squad"}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />{r.label}
              </button>
            );
          })}
        </div>

        {/* Award tiles */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {(["overall", "quality", "cost", "speed", "value"] as RankKey[]).map(k => (
            <Award key={k} k={k} rows={rows} active={rank === k} onClick={() => setRank(k)} />
          ))}
        </div>

        {/* Rank-by control */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-600">Rank by</span>
          <div className="inline-flex rounded-lg border bg-gray-50 p-0.5">
            {(Object.keys(METRICS) as RankKey[]).map(k => (
              <button key={k} onClick={() => setRank(k)}
                className={`px-3 py-1 text-sm rounded-md ${rank === k ? "bg-white shadow-sm font-medium" : "text-gray-600 hover:text-gray-900"}`}>
                {METRICS[k].label}
              </button>
            ))}
          </div>
          <span className="text-xs text-gray-500">{metric.hint}</span>
        </div>

        <div className="mt-3 grid lg:grid-cols-5 gap-4 items-start">
          {/* Leaderboard */}
          <section className="lg:col-span-2 rounded-xl border bg-white p-3">
            <h2 className="text-sm font-semibold px-1">Leaderboard · {metric.label}</h2>
            <ol className="mt-2 space-y-2">
              {ranked.map((r, i) => <LeaderRow key={r.id} r={r} i={i} m={metric} rows={ranked} active={selected?.id === r.id} onClick={() => setSel(r.id)} />)}
            </ol>
          </section>

          {/* Scatter */}
          <section className="lg:col-span-3 rounded-xl border bg-white p-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-sm font-semibold">Quality vs cost</h2>
              <span className="text-xs text-gray-500">top-left is best · dashed line = best quality for the money</span>
            </div>
            <Scatter rows={rows} onTip={showTip} onLeave={hideTip} onPick={setSel} />
          </section>
        </div>

        {/* Small multiples */}
        <section className="mt-4 grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {(["quality", "cost", "speed", "tokens"] as RankKey[]).map(k => (
            <MiniBars key={k} m={METRICS[k]} rows={ranked} onTip={showTip} onLeave={hideTip} />
          ))}
        </section>

        {/* Drill-down */}
        {selected && <Breakdown r={selected} onTip={showTip} onLeave={hideTip} onRepeat={n => repeat(selected.session_id, selected.session_name, n)} msg={repeatMsg} />}

        {/* Full table */}
        <FullTable rows={ranked} onPick={setSel} />

        {/* Weights */}
        <details className="mt-4 rounded-xl border bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold">How the overall score works (adjust weights)</summary>
          <div className="mt-2 text-xs text-gray-700 space-y-1">
            <p><b>Overall (0–100) = Quality × (1 − efficiency penalty)</b></p>
            <p><b>Quality</b> = weighted average of whatever exists: judge panel (×10), hidden-test pass rate (×100), human rating (1★ = 0, 5★ = 100).</p>
            <p><b>Efficiency penalty</b> = how far each squad is from the best one <i>on this task</i>: costing 2× the cheapest squad loses half of the cost weight, being 2× slower loses half of the speed weight; each human edit/rejection costs a third of the help weight.</p>
            <p className="text-gray-500">A failed run scores ≈0 however cheap it was; the best, cheapest, fastest squad scores 100. Scores never leave 0–100.</p>
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
            {W.map(k => (
              <label key={k} className="block">{WLABEL[k]} <b>{isPenalty(k) ? `${Math.round(w[k] * 100)}%` : `×${w[k]}`}</b>
                <input type="range" min={0} max={isPenalty(k) ? 0.5 : 2} step={isPenalty(k) ? 0.05 : 0.1} value={w[k]} className="w-full"
                  onChange={e => setW({ ...w, [k]: Number(e.target.value) })} onMouseUp={() => load(w)} onTouchEnd={() => load(w)} onKeyUp={() => load(w)} />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500">Release a slider to re-rank. Quality weights are relative (×); penalties are the most a squad can lose for being worst at that.</p>
        </details>
      </>)}

      {tip && (
        <div className="pointer-events-none fixed z-50 rounded-md border bg-white px-2.5 py-1.5 text-xs shadow-lg"
          style={{ left: Math.min(tip.x + 12, (typeof window !== "undefined" ? window.innerWidth : 9999) - 240), top: tip.y + 12 }}>
          {tip.body}
        </div>
      )}
    </main>
  );
}

/* ---------- pieces ---------- */

const ICON: Record<RankKey, string> = { overall: "🏆", quality: "🎯", cost: "💸", speed: "⚡", value: "💎", tokens: "🔤" };

function Award({ k, rows, active, onClick }: { k: RankKey; rows: Row[]; active: boolean; onClick: () => void }) {
  const m = METRICS[k];
  const r = rankBy(rows, m).filter(x => m.get(x) != null);
  const best = r[0], next = r[1];
  let delta = "";
  if (best && next) {
    const a = m.get(best)!, b = m.get(next)!;
    if (m.better === "low") delta = Math.abs(a - b) < 1e-9 ? `tied with ${next.label}` : a > 0 ? `${(b / a).toFixed(1)}× ${k === "cost" || k === "value" ? "cheaper" : k === "speed" ? "faster" : "fewer"} than next` : "free";
    else delta = Math.abs(a - b) < 1e-9 ? `tied with ${next.label}` : `+${m.fmt(a - b).replace(/\/100?$/, "")} over next`;
  }
  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-3 bg-white transition ${active ? "ring-2 ring-indigo-500 border-transparent" : "hover:border-gray-400"}`}>
      <div className="text-xs text-gray-500">{ICON[k]} {k === "overall" ? "Best overall" : k === "quality" ? "Highest quality" : k === "value" ? "Cheapest correct answer" : m.label}</div>
      {best ? (<>
        <div className="mt-1 flex items-center gap-1.5 font-semibold truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: best.color }} /><span className="truncate">{best.label}</span></div>
        <div className="text-xl font-semibold tabular-nums">{m.fmt(m.get(best)!)}</div>
        <div className="text-[11px] text-gray-500 h-4 truncate">{k === "value" ? [`${best.squadWins}/${best.squadJudged} correct`, delta].filter(Boolean).join(" · ") : delta}</div>
      </>) : <div className="mt-1 text-sm text-gray-400">not evaluated yet</div>}
    </button>
  );
}

function Status({ s }: { s?: string }) {
  const map: Record<string, [string, string]> = { complete: ["✓ complete", "bg-green-50 text-green-800 border-green-200"], partial: ["◐ partial", "bg-amber-50 text-amber-800 border-amber-200"], failed: ["✕ failed", "bg-red-50 text-red-800 border-red-200"] };
  const [t, c] = map[s ?? ""] ?? ["– not judged", "bg-gray-50 text-gray-600 border-gray-200"];
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] whitespace-nowrap ${c}`}>{t}</span>;
}

function LeaderRow({ r, i, m, rows, active, onClick }: { r: Row; i: number; m: Metric; rows: Row[]; active: boolean; onClick: () => void }) {
  const vals = rows.map(m.get).filter((v): v is number => v != null);
  const v = m.get(r);
  const max = Math.max(...vals, 0), min = Math.min(...vals, 0);
  // bar length: share of best (higher-better) or best/value (lower-better), so the winner is always full
  const frac = v == null ? 0 : m.better === "high" ? (max > min ? (v - Math.min(min, 0)) / (max - Math.min(min, 0)) : 1) : v > 0 ? Math.min(...vals.filter(x => x > 0), v) / v : 1;
  return (
    <li>
      <button onClick={onClick} className={`w-full text-left rounded-lg border p-2.5 flex gap-3 items-center ${active ? "border-indigo-400 bg-indigo-50/40" : "hover:bg-gray-50"}`}>
        <span className={`text-lg font-semibold w-6 text-center tabular-nums ${i === 0 && v != null ? "text-indigo-700" : "text-gray-400"}`}>{i + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
            <span className="font-medium truncate">{r.label}</span><Status s={r.completion_status} /></div>
          <div className="mt-1 flex flex-wrap gap-1">{(r.models ?? []).slice(0, 4).map(x => <span key={x} className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-700">{shortModel(x)}</span>)}</div>
          <div className="mt-1.5 h-1.5 rounded-full bg-gray-100"><div className="h-1.5 rounded-full" style={{ width: `${Math.max(frac * 100, v == null ? 0 : 3)}%`, background: r.color }} /></div>
        </div>
        <div className="text-right">
          <div className="font-semibold tabular-nums">{v == null ? "—" : m.fmt(v)}</div>
          <div className="text-[11px] text-gray-500 tabular-nums">{money(r.cost)} · {secs(r.time)}</div>
          <div className="text-[11px] text-gray-500 tabular-nums" title="Runs of this squad marked complete / runs judged">{r.squadWins}/{r.squadJudged} correct</div>
        </div>
      </button>
    </li>
  );
}

type TipFns = { onTip: (e: React.MouseEvent, b: ReactNode) => void; onLeave: () => void };

function TipBody({ r }: { r: Row }) {
  return (<div className="space-y-0.5">
    <div className="flex items-center gap-1.5 font-semibold"><span className="h-2 w-2 rounded-full" style={{ background: r.color }} />{r.label}</div>
    <div>Quality <b>{r.quality == null ? "—" : `${r.quality.toFixed(1)}/10`}</b> · Overall <b>{r.composite_score == null ? "—" : `${Number(r.composite_score).toFixed(0)}/100`}</b></div>
    <div>Cost <b>{money(r.cost)}</b> · Time <b>{secs(r.time)}</b> · Tokens <b>{kfmt(r.tokens)}</b></div>
  </div>);
}

function Scatter({ rows, onTip, onLeave, onPick }: { rows: Row[]; onPick: (id: string) => void } & TipFns) {
  const pts = rows.filter(r => r.quality != null);
  const W = 640, H = 330, L = 48, R = 24, T = 22, B = 40;
  const maxC = Math.max(...pts.map(p => p.cost), 0.0001) * 1.15;
  const x = (c: number) => L + (c / maxC) * (W - L - R);
  const y = (q: number) => T + (1 - q / 10) * (H - T - B);
  /* label placement: put each label beside its dot, then nudge down any label that would overlap one already placed */
  const placed: { x: number; y: number; w: number }[] = [];
  const labelPos: Record<string, { x: number; y: number; anchor: "start" | "end" }> = {};
  [...pts].sort((a, b) => b.quality! - a.quality! || a.cost - b.cost).forEach(p => {
    const right = x(p.cost) > W * 0.7, text = p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label;
    const w = text.length * 6.2, lx = right ? x(p.cost) - 11 : x(p.cost) + 11;
    const x0 = right ? lx - w : lx;
    let ly = y(p.quality!) + 4;
    while (placed.some(o => Math.abs(o.y - ly) < 13 && x0 < o.x + o.w && o.x < x0 + w)) ly += 13;
    placed.push({ x: x0, y: ly, w }); labelPos[p.id] = { x: lx, y: ly, anchor: right ? "end" : "start" };
  });
  const frontier: Row[] = []; let bestQ = -1;
  [...pts].sort((a, b) => a.cost - b.cost || b.quality! - a.quality!).forEach(p => { if (p.quality! > bestQ) { frontier.push(p); bestQ = p.quality!; } });
  const xt = [0, 0.25, 0.5, 0.75, 1].map(f => f * maxC);
  if (!pts.length) return <div className="h-64 grid place-items-center text-sm text-gray-400">Run the judge on at least one run to plot quality.</div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-1" role="img" aria-label="Scatter of judge quality against cost per run">
      <rect x={L} y={T} width={(W - L - R) * 0.35} height={(H - T - B) * 0.35} fill="#2a78d6" opacity={0.05} rx={6} />
      <text x={L + 8} y={T + (H - T - B) * 0.35 - 8} fontSize={11} fill="#52514e">↖ cheaper &amp; better</text>
      {[0, 2.5, 5, 7.5, 10].map(q => <g key={q}><line x1={L} x2={W - R} y1={y(q)} y2={y(q)} stroke="#e7e6e2" /><text x={L - 8} y={y(q) + 4} fontSize={11} textAnchor="end" fill="#52514e">{q}</text></g>)}
      {xt.map((c, i) => <text key={i} x={x(c)} y={H - B + 18} fontSize={11} textAnchor="middle" fill="#52514e">{money(c)}</text>)}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#b8b7b1" />
      <text x={(L + W - R) / 2} y={H - 4} fontSize={11} textAnchor="middle" fill="#52514e">cost per run</text>
      <text x={12} y={(T + H - B) / 2} fontSize={11} textAnchor="middle" fill="#52514e" transform={`rotate(-90 12 ${(T + H - B) / 2})`}>judge quality /10</text>
      {frontier.length > 1 && <polyline fill="none" stroke="#52514e" strokeDasharray="4 4" strokeWidth={1.5}
        points={frontier.map((p, i) => i === 0 ? `${x(p.cost)},${y(p.quality!)}` : `${x(p.cost)},${y(frontier[i - 1].quality!)} ${x(p.cost)},${y(p.quality!)}`).join(" ")} />}
      {pts.map(p => (
        <g key={p.id} className="cursor-pointer" onClick={() => onPick(p.id)} onMouseMove={e => onTip(e, <TipBody r={p} />)} onMouseLeave={onLeave}>
          <circle cx={x(p.cost)} cy={y(p.quality!)} r={16} fill="transparent" />
          <circle cx={x(p.cost)} cy={y(p.quality!)} r={7} fill={p.color} stroke="#fff" strokeWidth={2} />
          <text x={labelPos[p.id].x} y={labelPos[p.id].y} fontSize={11} fill="#0b0b0b" textAnchor={labelPos[p.id].anchor}
            stroke="#fff" strokeWidth={3} paintOrder="stroke">{p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function MiniBars({ m, rows, onTip, onLeave }: { m: Metric; rows: Row[] } & TipFns) {
  const vals = rows.map(r => m.get(r)).filter((v): v is number => v != null);
  const max = Math.max(...vals, 0) || 1;
  const best = vals.length ? (m.better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="flex items-baseline justify-between"><h3 className="text-sm font-semibold">{m.short}</h3><span className="text-[11px] text-gray-500">{m.better === "high" ? "higher is better" : "lower is better"}</span></div>
      <div className="mt-2 space-y-1.5">
        {rows.map(r => {
          const v = m.get(r);
          return (
            <div key={r.id} className="grid grid-cols-[96px_1fr_auto] items-center gap-2 text-xs" onMouseMove={e => onTip(e, <TipBody r={r} />)} onMouseLeave={onLeave}>
              <span className="truncate text-gray-700" title={r.label}>{r.label}</span>
              <div className="h-3.5 rounded-r bg-gray-50">{v != null && <div className="h-3.5 rounded-r" style={{ width: `${Math.max((v / max) * 100, 2)}%`, background: r.color }} />}</div>
              <span className="tabular-nums w-20 text-right whitespace-nowrap">{v == null ? "—" : m.fmt(v)}{v != null && v === best && vals.length > 1 ? " ★" : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Breakdown({ r, onTip, onLeave, onRepeat, msg }: { r: Row; onRepeat: (n: number) => void; msg: string } & TipFns) {
  const nodes: CompareNode[] = r.nodes ?? [];
  const tc = nodes.reduce((s, n) => s + Number(n.cost_usd), 0) || 1;
  const tt = nodes.reduce((s, n) => s + Number(n.latency_ms), 0) || 1;
  const topCost = [...nodes].sort((a, b) => Number(b.cost_usd) - Number(a.cost_usd))[0];
  return (
    <section className="mt-4 rounded-xl border bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: r.color }} />Where the money and time went · {r.label}</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => onRepeat(3)} className="rounded-md border px-2 py-1 text-xs hover:bg-gray-50"
            title="Run this squad 3 more times on this task and judge each run, to measure how reliably it gets the answer right">Run 3× more</button>
          <a className="text-xs text-indigo-700" href={`/runs/${r.id}`}>open run →</a>
        </div>
      </div>
      {msg && <p className="mt-1 px-1 text-xs text-indigo-800">{msg}</p>}
      <p className="mt-1 px-1 text-xs text-gray-600">Reliability: <b>{r.squadWins}/{r.squadJudged}</b> judged runs correct · average {money(r.squadAvgCost)} per run → <b>{r.value == null ? "no correct answer yet" : `${money(r.value)} per correct answer`}</b></p>
      <div className="mt-2 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
        <Stat k="Cost / run" v={money(r.cost)} /><Stat k="Projected / 1k runs" v={money(r.per1k)} /><Stat k="Wall-clock" v={secs(r.time)} />
        <Stat k="Tokens in / out" v={`${kfmt(Number(r.total_input_tokens ?? 0))} / ${kfmt(Number(r.total_output_tokens ?? 0))}`} />
        <Stat k="Output tok/s" v={r.tps == null ? "—" : r.tps.toFixed(0)} /><Stat k="LLM calls · loops" v={`${r.llm_calls ?? 0} · ${(r.loops_used ?? 0) + 1}`} />
      </div>
      {topCost && nodes.length > 1 && <p className="mt-2 px-1 text-xs text-gray-600">💡 <b>{topCost.role}</b> ({shortModel(topCost.model_or_tool)}) is {Math.round(Number(topCost.cost_usd) / tc * 100)}% of the cost — the first place to try a cheaper model.</p>}
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-gray-500"><tr><th className="py-1 pr-2">Node</th><th className="pr-2">Model / tool</th><th className="pr-2 text-right">Calls</th><th className="pr-2 text-right">Tokens</th><th className="pr-2 w-1/4">Cost share</th><th className="w-1/4">Time share</th></tr></thead>
          <tbody>{nodes.map(n => {
            const cs = Number(n.cost_usd) / tc, ts = Number(n.latency_ms) / tt;
            return (
              <tr key={n.node_id} className="border-t" onMouseMove={e => onTip(e, <div><b>{n.role}</b> · {n.model_or_tool}<br />{money(Number(n.cost_usd))} · {secs(Number(n.latency_ms))}{n.reused ? " · reused from parent run" : ""}</div>)} onMouseLeave={onLeave}>
                <td className="py-1.5 pr-2 font-medium">{n.role}{n.reused && <span className="ml-1 text-[10px] text-amber-700">reused</span>}</td>
                <td className="pr-2 text-gray-700">{shortModel(n.model_or_tool ?? "")}</td>
                <td className="pr-2 text-right tabular-nums">{n.calls}</td>
                <td className="pr-2 text-right tabular-nums">{kfmt(Number(n.input_tokens) + Number(n.output_tokens))}</td>
                <td className="pr-2"><Share f={cs} color={r.color} label={money(Number(n.cost_usd))} /></td>
                <td><Share f={ts} color={r.color} label={secs(Number(n.latency_ms))} /></td>
              </tr>
            );
          })}
            {nodes.length === 0 && <tr><td colSpan={6} className="py-2 text-gray-400">No node data for this run.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => <div className="rounded-lg bg-gray-50 px-2 py-1.5"><div className="text-gray-500">{k}</div><div className="font-semibold tabular-nums text-sm">{v}</div></div>;
const Share = ({ f, color, label }: { f: number; color: string; label: string }) => (
  <div className="flex items-center gap-2"><div className="h-2.5 flex-1 rounded-r bg-gray-50"><div className="h-2.5 rounded-r" style={{ width: `${Math.max(f * 100, 1)}%`, background: color }} /></div><span className="w-28 tabular-nums text-right whitespace-nowrap">{Math.round(f * 100)}% · {label}</span></div>
);

type Col = { k: string; label: string; get: (r: Row) => number | string | null; fmt?: (r: Row) => string };
const COLS: Col[] = [
  { k: "score", label: "Overall", get: r => r.composite_score ?? null, fmt: r => r.composite_score == null ? "—" : Number(r.composite_score).toFixed(0) },
  { k: "qscore", label: "Quality", get: r => r.quality_score ?? null, fmt: r => r.quality_score == null ? "—" : Number(r.quality_score).toFixed(0) },
  { k: "judge", label: "Judge", get: r => r.final_judge_score ?? null },
  { k: "tests", label: "Tests", get: r => r.test_pass_rate ?? null, fmt: r => r.test_pass_rate == null ? "—" : `${Math.round(Number(r.test_pass_rate) * 100)}%` },
  { k: "human", label: "Human", get: r => r.human_score ?? null },
  { k: "spread", label: "Judge spread", get: r => r.judge_spread == null ? null : Number(r.judge_spread),
    fmt: r => r.judge_spread == null || (r.judge_count ?? 0) < 2 ? "—" : `±${Number(r.judge_spread).toFixed(1)}${Number(r.judge_spread) >= 3 ? " ⚠" : ""}` },
  { k: "cost", label: "Cost", get: r => r.cost, fmt: r => money(r.cost) },
  { k: "per1k", label: "$/1k runs", get: r => r.per1k, fmt: r => money(r.per1k) },
  { k: "time", label: "Time", get: r => r.time, fmt: r => secs(r.time) },
  { k: "tin", label: "Tok in", get: r => Number(r.total_input_tokens ?? 0), fmt: r => kfmt(Number(r.total_input_tokens ?? 0)) },
  { k: "tout", label: "Tok out", get: r => Number(r.total_output_tokens ?? 0), fmt: r => kfmt(Number(r.total_output_tokens ?? 0)) },
  { k: "tps", label: "Tok/s", get: r => r.tps, fmt: r => r.tps == null ? "—" : r.tps.toFixed(0) },
  { k: "calls", label: "LLM calls", get: r => r.llm_calls ?? 0 },
  { k: "int", label: "Interventions", get: r => r.interventions_count ?? 0 },
  { k: "success", label: "Correct", get: r => r.squadJudged ? r.squadWins / r.squadJudged : null, fmt: r => `${r.squadWins}/${r.squadJudged}` },
  { k: "value", label: "$/correct", get: r => r.value, fmt: r => r.value == null ? "never" : money(r.value) },
];

function FullTable({ rows, onPick }: { rows: Row[]; onPick: (id: string) => void }) {
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 } | null>(null);
  const col = COLS.find(c => c.k === sort?.k);
  const data = col ? [...rows].sort((a, b) => {
    const x = col.get(a), y = col.get(b);
    if (x == null) return 1; if (y == null) return -1;
    return (Number(x) - Number(y)) * sort!.dir;
  }) : rows;
  return (
    <section className="mt-4 rounded-xl border bg-white">
      <div className="px-4 pt-3 text-sm font-semibold">All parameters <span className="font-normal text-xs text-gray-500">· click a column to sort</span></div>
      <div className="overflow-x-auto">
        <table className="mt-2 w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-600"><tr>
            <th className="p-2">Squad</th><th className="p-2">Status</th>
            {COLS.map(c => <th key={c.k} className="p-2 text-right cursor-pointer select-none whitespace-nowrap hover:text-gray-900"
              onClick={() => setSort(s => s?.k === c.k ? { k: c.k, dir: s.dir === 1 ? -1 : 1 } : { k: c.k, dir: -1 })}>
              {c.label}{sort?.k === c.k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}</th>)}
            <th className="p-2" />
          </tr></thead>
          <tbody>{data.map(r => (
            <tr key={r.id} className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => onPick(r.id)}>
              <td className="p-2 whitespace-nowrap"><span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ background: r.color }} />{r.label}</td>
              <td className="p-2"><Status s={r.completion_status} /></td>
              {COLS.map(c => <td key={c.k} className="p-2 text-right tabular-nums">{c.fmt ? c.fmt(r) : (c.get(r) ?? "—")}</td>)}
              <td className="p-2"><a className="text-indigo-700" href={`/runs/${r.id}`} onClick={e => e.stopPropagation()}>open</a></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

export default function Page() { return <Suspense><Compare /></Suspense>; }
