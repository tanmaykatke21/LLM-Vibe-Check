"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Size (px) that persists per key, clamped to [min, max]. */
export function useStoredSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(initial);
  useEffect(() => {
    try { const v = Number(localStorage.getItem(`llmsquad:${key}`)); if (v) setSize(Math.min(max, Math.max(min, v))); } catch {}
  }, [key, min, max]);
  const update = useCallback((v: number) => {
    const c = Math.min(max, Math.max(min, Math.round(v)));
    setSize(c);
    try { localStorage.setItem(`llmsquad:${key}`, String(c)); } catch {}
  }, [key, min, max]);
  return [size, update] as const;
}

/**
 * Drag handle. axis="x": drag left/right to resize a panel on the RIGHT of the handle
 * (dragging left makes it wider). axis="y": drag up/down to resize a panel BELOW the handle
 * (dragging up makes it taller). Double-click resets to `reset`.
 */
export function ResizeHandle({ axis, size, onResize, reset, label }:
  { axis: "x" | "y"; size: number; onResize: (v: number) => void; reset: number; label: string }) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { pos: axis === "x" ? e.clientX : e.clientY, size };
    setActive(true);
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const delta = (axis === "x" ? e.clientX : e.clientY) - start.current.pos;
    onResize(start.current.size - delta);
  };
  const end = () => {
    start.current = null; setActive(false);
    document.body.style.cursor = ""; document.body.style.userSelect = "";
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 50 : 15;
    if ((axis === "x" && e.key === "ArrowLeft") || (axis === "y" && e.key === "ArrowUp")) { e.preventDefault(); onResize(size + step); }
    if ((axis === "x" && e.key === "ArrowRight") || (axis === "y" && e.key === "ArrowDown")) { e.preventDefault(); onResize(size - step); }
  };

  const base = axis === "x"
    ? "w-2 shrink-0 cursor-col-resize flex items-center justify-center"
    : "h-2 shrink-0 cursor-row-resize flex items-center justify-center";
  const grip = axis === "x" ? "w-0.5 h-10 rounded" : "h-0.5 w-10 rounded";
  return (
    <div role="separator" aria-orientation={axis === "x" ? "vertical" : "horizontal"} aria-label={label}
      aria-valuenow={size} tabIndex={0} title={`${label} — drag to resize, double-click to reset`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={end} onPointerCancel={end}
      onDoubleClick={() => onResize(reset)} onKeyDown={onKeyDown}
      className={`${base} group bg-line hover:bg-accent-soft focus:bg-accent-soft outline-none ${active ? "bg-accent-soft" : ""}`}>
      <div className={`${grip} ${active ? "bg-accent" : "bg-faint group-hover:bg-accent"}`} />
    </div>
  );
}
