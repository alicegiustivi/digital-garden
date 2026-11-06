import { useEffect, useState } from "react";

// A small message at the bottom of the screen that offers Undo for a few seconds (issue #30).
type Toast = { id: number; message: string; undo?: () => Promise<unknown> | void };
let current: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const publish = () => subs.forEach((f) => f());
export const UNDO_MS = 8000;

export function showToast(message: string, undo?: Toast["undo"]) {
  clearTimeout(timer);
  current = { id: ++seq, message, undo };
  timer = setTimeout(dismiss, UNDO_MS);
  publish();
}
export function dismiss() { clearTimeout(timer); current = null; publish(); }

export function Toasts() {
  const [t, set] = useState<Toast | null>(current);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const f = () => { set(current); setError(undefined); };
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  if (!t) return null;
  const undo = async () => {
    try { await t.undo?.(); dismiss(); } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="toast" role="status" aria-live="polite" key={t.id}>
      <span>{error ?? t.message}</span>
      {t.undo && !error && <button className="undo" onClick={undo}>Undo</button>}
      <button className="x" onClick={dismiss} aria-label="Dismiss"><span aria-hidden>×</span></button>
    </div>
  );
}
