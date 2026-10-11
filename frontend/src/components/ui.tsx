"use client";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { providerOf, shortModel } from "@/lib/providers";

type Variant = "primary" | "secondary" | "ghost" | "danger";
const V: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-[#4338CA] border border-accent",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-paper",
  ghost: "bg-transparent text-muted hover:text-ink hover:bg-paper border border-transparent",
  danger: "bg-surface text-bad border border-line-strong hover:bg-bad-soft",
};
export function Button({ variant = "secondary", size = "md", className = "", ...p }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const s = size === "sm" ? "h-7 px-2.5 text-xs" : "h-8 px-3 text-[13px]";
  return <button {...p} className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:opacity-40 disabled:pointer-events-none ${s} ${V[variant]} ${className}`} />;
}

export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return <section className={`rounded-xl border border-line bg-surface ${className}`}>{children}</section>;
}

const STATUS: Record<string, [string, string]> = {
  done: ["Done", "bg-good-soft text-good"], complete: ["Complete", "bg-good-soft text-good"],
  failed: ["Failed", "bg-bad-soft text-bad"], partial: ["Partial", "bg-warn-soft text-warn"],
  paused: ["Waiting for you", "bg-warn-soft text-warn"], running: ["Running", "bg-accent-soft text-accent"],
  queued: ["Queued", "bg-paper text-muted"],
};
export function StatusPill({ status }: { status?: string | null }) {
  const [label, cls] = STATUS[status ?? ""] ?? [status || "Not judged", "bg-paper text-muted"];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
    {status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />}{label}</span>;
}

/** Company-coloured model chip: the one place colour carries identity. */
export function ModelChip({ model, full = false, className = "" }: { model?: string | null; full?: boolean; className?: string }) {
  const p = providerOf(model);
  return (
    <span title={model ?? ""} className={`inline-flex max-w-full items-center gap-1.5 rounded-md py-0.5 pl-0.5 pr-1.5 text-[11px] font-mono ${className}`}
      style={{ background: p.soft, color: p.color }}>
      <span className="grid h-4 min-w-4 place-items-center rounded px-0.5 text-[9px] font-sans font-semibold text-white" style={{ background: p.color }}>{p.letter}</span>
      <span className="truncate">{full ? model : shortModel(model)}</span>
    </span>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return <Button size="sm" variant="ghost" onClick={async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  }}>{done ? "Copied" : label}</Button>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong p-6 text-center">
    <p className="font-medium text-ink">{title}</p>{children && <div className="mt-1 text-[13px] text-muted">{children}</div>}</div>;
}

/** Renders model output: fenced code blocks get their own box with a copy button; the rest stays as text. */
export function OutputText({ text }: { text: string }) {
  const parts = text.split(/```([\w+-]*)[ \t]*\r?\n([\s\S]*?)```/g);
  const out: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i]?.trim()) out.push(<p key={`t${i}`} className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{parts[i].trim()}</p>);
    if (parts[i + 2] !== undefined) out.push(
      <div key={`c${i}`} className="overflow-hidden rounded-lg border border-line">
        <div className="flex items-center justify-between border-b border-line bg-paper px-3 py-1 text-[11px] text-muted">
          <span>{parts[i + 1] || "code"}</span><CopyButton text={parts[i + 2]} /></div>
        <pre className="max-h-[60vh] overflow-auto bg-surface p-3 font-mono text-[12px] leading-relaxed">{parts[i + 2]}</pre>
      </div>);
  }
  return <div className="space-y-3">{out}</div>;
}

export const ROLE_GLYPH: Record<string, string> = {
  planner: "◇", executor: "▶", reviewer: "✓", debugger: "⌁", architect: "▦", verifier: "✓", writer: "✎",
  researcher: "⌕", "database manager": "▤", "data cleaner": "≋", checkpoint: "⏸", tool: "♪",
};
