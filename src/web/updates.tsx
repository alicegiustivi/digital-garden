import { useEffect, useState } from "react";

// An open window notices when a newer Garden has been installed (the dock app is a window that can stay open for days).
// Out of sight, it reloads itself. In sight, it asks, so nothing you are typing is lost.
const ask = () => fetch("/api/version", { cache: "no-store" }).then((r) => r.json()).then((j) => j.version as string).catch(() => null);

export function UpdateBar() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    let mine: string | null = null;
    const check = async () => {
      const now = await ask();
      if (!now) return;
      if (mine === null) { mine = now; return; }
      if (now !== mine) { if (document.hidden) location.reload(); else setStale(true); }
    };
    check();
    const timer = setInterval(check, 60_000);
    const on = () => check();
    window.addEventListener("focus", on);
    document.addEventListener("visibilitychange", on);
    return () => { clearInterval(timer); window.removeEventListener("focus", on); document.removeEventListener("visibilitychange", on); };
  }, []);
  if (!stale) return null;
  return (
    <div className="toast update-bar" role="status" aria-live="polite">
      <span>A newer Garden is ready.</span>
      <button className="undo" onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
