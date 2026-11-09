// Backups (issue #39): the quiet "Backed up today 03:12" line under More, the page behind it, and the one-line note on This week.
import { useEffect, useState } from "react";
import { call } from "./api";
import { Hint } from "./ui";

export type BackupStatus = { folder: string | null; line: string; lastOk: string | null; lastError: string | null; warning: { text: string } | null };
const backupApi = {
  status: () => call<BackupStatus>("GET", "/api/backup"),
  folder: (path: string) => call<BackupStatus>("PUT", "/api/backup/folder", { path }),
  run: () => call<BackupStatus & { ok: boolean; message: string }>("POST", "/api/backup/run"),
};

export function useBackup(version?: number) {
  const [s, setS] = useState<BackupStatus | null>(null);
  useEffect(() => { backupApi.status().then(setS).catch(() => {}); }, [version]);
  return [s, setS] as const;
}

/** On This week: only when Backups have failed two days running. No system notification, just this line. */
export function BackupNote() {
  const [s, setS] = useBackup();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  if (!s?.warning) return null;
  const again = async () => { setBusy(true); try { const r = await backupApi.run(); setS(r); setMsg(r.ok ? "" : r.message); } finally { setBusy(false); } };
  return (
    <p className="inbox-warn" role="alert">
      {s.warning.text} <button className="linkish" disabled={busy} onClick={again}>{busy ? "Trying…" : "Try again"}</button>
      {msg && <span className="small"> · {msg}</span>}
    </p>
  );
}

export function BackupPage() {
  const [s, setS] = useBackup();
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (s?.folder) setPath(s.folder); }, [s?.folder]);
  const save = async () => { try { setS(await backupApi.folder(path)); setError(""); } catch (e: any) { setError(e.message); } };
  const now = async () => { setBusy(true); setNote(""); try { const r = await backupApi.run(); setS(r); setNote(r.message); } finally { setBusy(false); } };
  return (
    <main className="wrap text-page backup-page">
      <header className="vol"><h2>Backup</h2></header>
      <p>{s ? s.line : "Opening…"}</p>
      {s?.warning && <p className="inbox-warn" role="alert">{s.warning.text}</p>}
      {s?.lastError && <p className="inbox-warn">{s.lastError}</p>}
      <Hint short="Every day your Garden is copied to Google Drive, scrambled with a password only you know.">
        <p>Nobody, not even Google, can read the copies. Private Objects are included, because a Backup is how the Garden itself is put back. This is not an Export.</p>
        <p>To put the Garden back (new Mac, or after a mistake), ask an agent: “restore my Garden”. It moves the current Garden aside first and never overwrites it.</p>
      </Hint>
      <form className="inbox-folder" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Library/CloudStorage/GoogleDrive-…/My Drive/Garden backups" aria-label="Drive backup folder" />
        <button className="pill action" type="submit">Use this folder</button>
        {error && <span className="inbox-warn">{error}</span>}
      </form>
      <p><button className="pill action" disabled={busy || !s?.folder} onClick={now}>{busy ? "Backing up…" : "Back up now"}</button> {note && <span className="quiet">{note}</span>}</p>
    </main>
  );
}
