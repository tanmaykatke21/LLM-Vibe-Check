"use client";
import { useMemo, useState } from "react";

export type ModelInfo = { id: string; input_per_m?: number; output_per_m?: number };

const FEATURED = [
  "anthropic/claude-haiku-5.5", "anthropic/claude-sonnet-5.5", "anthropic/claude-opus-5.5", "anthropic/claude-fable-5.1",
];
const PROVIDER_ORDER = ["anthropic", "openai", "google", "meta-llama", "mistralai", "deepseek", "moonshotai", "z-ai", "qwen", "x-ai"];

const price = (m?: ModelInfo) => {
  if (!m || m.input_per_m == null) return "";
  if (m.input_per_m < 0 || (m.output_per_m ?? 0) < 0) return " — variable price";
  if (m.input_per_m === 0 && (m.output_per_m ?? 0) === 0) return " — free";
  return ` — $${fmt(m.input_per_m)} / $${fmt(m.output_per_m ?? 0)} per 1M`;
};
const fmt = (n: number) => (n >= 10 ? n.toFixed(0) : n >= 1 ? n.toFixed(2) : n.toFixed(3));

/** Searchable model dropdown, grouped by provider, featured models first. */
export default function ModelPicker({ value, models, onChange, compact }:
  { value?: string; models: ModelInfo[]; onChange: (id: string) => void; compact?: boolean }) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => Object.fromEntries(models.map(m => [m.id, m])), [models]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const match = (id: string) => !ql || id.toLowerCase().includes(ql);
    const g: Record<string, string[]> = {};
    for (const m of models) {
      if (!match(m.id) || FEATURED.includes(m.id) || m.id.includes(":batch")) continue;
      const p = m.id.split("/")[0];
      (g[p] ??= []).push(m.id);
    }
    const order = Object.keys(g).sort((a, b) => {
      const ia = PROVIDER_ORDER.indexOf(a), ib = PROVIDER_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    return { featured: FEATURED.filter(match), order, g };
  }, [models, q]);

  const cls = "field";
  const hasValue = value && (byId[value] || FEATURED.includes(value));
  return (
    <div className={compact ? "flex gap-1 items-center" : "space-y-1 mt-1"}>
      {!compact && <input className={cls} placeholder="Search models (e.g. gpt, gemini, llama)…" value={q} onChange={e => setQ(e.target.value)} />}
      <select className={cls} value={value ?? ""} onChange={e => onChange(e.target.value)}>
        {!hasValue && value && <option value={value}>{value} (custom)</option>}
        {groups.featured.length > 0 && <optgroup label="★ Featured">
          {groups.featured.map(id => <option key={id} value={id}>{id}{price(byId[id])}</option>)}</optgroup>}
        {groups.order.map(p => <optgroup key={p} label={p}>
          {groups.g[p].map(id => <option key={id} value={id}>{id}{price(byId[id])}</option>)}</optgroup>)}
      </select>
      {!compact && <div className="text-[11px] text-faint">{models.length} models available{q && `, showing matches for "${q}"`}</div>}
    </div>
  );
}
