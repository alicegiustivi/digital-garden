// Export my Garden (issue #40): a readable copy in a dated folder. Not a Backup: it is not encrypted and can't restore the Garden.
import { useEffect, useRef, useState } from "react";
import { call } from "./api";

type ExportStatus = {
  state: "idle" | "running" | "done" | "failed"; line: string; progress: { done: number; total: number } | null;
  path?: string | null; leftOutPrivateObjects?: boolean; detail?: string | null; defaultFolder: string;
};
const exportApi = {
  status: () => call<ExportStatus>("GET", "/api/export"),
  start: (folder: string, leaveOutPrivate: boolean) => call<ExportStatus>("POST", "/api/export", { folder, leaveOutPrivate }),
  choose: () => call<{ path: string | null }>("POST", "/api/export/choose"),
  reveal: () => call("POST", "/api/export/reveal"),
};

export function ExportPage() {
  const [s, setS] = useState<ExportStatus | null>(null);
  const [folder, setFolder] = useState("");
  const [leaveOut, setLeaveOut] = useState(false);
  const [error, setError] = useState("");
  const asked = useRef(false);
  useEffect(() => { exportApi.status().then(setS).catch(() => {}); }, []);
  useEffect(() => { if (s && !asked.current) { asked.current = true; setFolder(s.defaultFolder); } }, [s]);
  // a quiet progress line while it runs; the owner can keep working meanwhile
  useEffect(() => {
    if (s?.state !== "running") return;
    const t = setInterval(() => exportApi.status().then(setS).catch(() => {}), 700);
    return () => clearInterval(t);
  }, [s?.state]);
  const choose = async () => { try { const r = await exportApi.choose(); if (r.path) setFolder(r.path); } catch (e: any) { setError(e.message); } };
  const start = async () => { setError(""); try { setS(await exportApi.start(folder, leaveOut)); } catch (e: any) { setError(e.message); } };
  const running = s?.state === "running";
  return (
    <main className="wrap text-page backup-page">
      <header className="vol"><h2>Export</h2></header>
      <p>Saves a copy of your whole Garden that you can read without the Garden: one readable file for each Object, plus one complete data file, your images and a “Read me first”. It works offline and uses no AI. It goes in a new dated folder, such as <em>Garden export {new Date().toISOString().slice(0, 10)}</em>.</p>
      <p className="inbox-warn" role="note"><strong>This Export is not encrypted.</strong> Anyone who can open the folder can read everything in it{leaveOut ? "." : ", including your Private Objects (they are marked Private)."} Keep it somewhere safe. An Export is not a Backup: it can’t put the Garden back.</p>
      <label className="field"><span>Save it in</span>
        <input value={folder} onChange={(e) => setFolder(e.target.value)} disabled={running} spellCheck={false} />{" "}
        <button className="pill toggle" onClick={choose} disabled={running}>Choose…</button>
      </label>
      <p><label><input type="checkbox" checked={leaveOut} onChange={(e) => setLeaveOut(e.target.checked)} disabled={running} /> Leave out Private Objects <span className="quiet small">(their Connections and Mentions are left out too; Mentions read “[a Private Object]”)</span></label></p>
      <p><button className="pill action" onClick={start} disabled={running || !folder.trim()}>{running ? "Exporting…" : "Export now"}</button></p>
      {error && <p className="inbox-warn" role="alert">{error}</p>}
      {running && <p className="quiet" aria-live="polite">{s!.line}</p>}
      {s?.state === "done" && (
        <p aria-live="polite">Done. {s.leftOutPrivateObjects ? "Private Objects were left out. " : ""}<button className="linkish" onClick={() => exportApi.reveal().catch((e) => setError(e.message))}>Show in Finder</button></p>
      )}
      {s?.state === "failed" && <p className="inbox-warn" role="alert">Export didn’t finish. Nothing was kept from it, so there is no half-finished copy. Try again.{s.detail ? <span className="small"> · {s.detail}</span> : null}</p>}
    </main>
  );
}
