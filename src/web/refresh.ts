import { useEffect, useState } from "react";

// A tiny "something about Connections changed" signal, so every list on screen (the page, the second pane, the peek window) reloads together.
let n = 0;
const subs = new Set<() => void>();
export const refresh = () => { n++; subs.forEach((f) => f()); };
export function useRefresh() {
  const [v, set] = useState(n);
  useEffect(() => {
    const f = () => set(n);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return v;
}
