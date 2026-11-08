// The Daily Inbox (issue #37): one page per day of what the owner sent from the phone, in time order.
// Not an Object: it can't be connected, tagged or made Private. Only phone captures appear here.
import { useCallback, useEffect, useState } from "react";
import { inboxApi, type InboxComment, type InboxEntry, type InboxStatus, type Types } from "./api";
import { Card } from "./Lists";
import { Icon } from "./ui";
import { showToast } from "./toast";

export const dayLabel = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  const days = Math.round((new Date().setHours(12, 0, 0, 0) - d.getTime()) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: days > 300 ? "numeric" : undefined });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function Warning({ s, onChanged }: { s: InboxStatus; onChanged: (s: InboxStatus) => void }) {
  const [path, setPath] = useState(s.folder ?? "");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(!s.folder);
  const save = async () => {
    try { onChanged(await inboxApi.inboxFolder(path)); setError(""); setOpen(false); }
    catch (e: any) { setError(e.message); }
  };
  return (
    <>
      {s.warning && <p className="inbox-warn" role="alert">{s.warning.text}</p>}
      {s.waiting > 0 && <p className="quiet small">{s.waiting} {s.waiting === 1 ? "capture is" : "captures are"} being picked up…</p>}
      <p className="quiet small">
        {s.folder ? <>Phone captures arrive in <code>{s.folder}</code>. </> : null}
        <button className="linkish" onClick={() => setOpen(!open)}>{s.folder ? "Change folder" : "Choose the folder"}</button>
      </p>
      {open && (
        <form className="inbox-folder" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/Users/you/Library/CloudStorage/GoogleDrive-…/My Drive/Garden inbox" aria-label="Drive inbox folder" />
          <button className="pill action" type="submit">Use this folder</button>
          {error && <span className="inbox-warn">{error}</span>}
        </form>
      )}
    </>
  );
}

function Entry({ e, types, onOpen, onChanged }: { e: InboxEntry; types: Types; onOpen: (id: string, ids: string[]) => void; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(e.comment ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(e.comment ?? ""), [e.comment]);
  const ids = e.objects.map((o) => o.id);
  const saveComment = async () => { setEditing(false); if (draft.trim() !== (e.comment ?? "")) { await inboxApi.inboxEdit(e.id, draft); onChanged(); } };
  const toThought = async () => { const r = await inboxApi.inboxThought(e.id); onChanged(); showToast("Made a Thought from your comment.", undefined); location.hash = `#/o/${r.id}`; };
  const retry = async () => {
    setBusy(true);
    try { const r = await inboxApi.inboxRetry(e.id); if (r.outcome !== "done") showToast(r.reason ?? "Still couldn't read it.", undefined); } finally { setBusy(false); onChanged(); }
  };
  return (
    <li className={`inbox-entry ${e.status}`}>
      <span className="when">{time(e.at)}{e.private && <> <Icon name="lock" /><span className="sr">Private</span></>}</span>
      <div className="inbox-body">
        {e.status === "failed" ? (
          <div className="inbox-failed">
            <strong>{e.refused ? "Not kept" : "Couldn't read this capture"}</strong>
            <p>{e.reason}</p>
            {e.comment && <p className="quiet small">Your words: {e.comment}</p>}
            <div className="row">
              {!e.refused && <button className="pill action" disabled={busy} onClick={retry}>{busy ? "Trying…" : "Retry"}</button>}
              <button className="pill action" onClick={() => inboxApi.inboxReveal(e.id)}>Show file</button>
            </div>
          </div>
        ) : (
          <>
            <div className="stories">{e.objects.map((o) => <Card key={o.id} o={o} types={types} onOpen={() => onOpen(o.id, ids)} />)}</div>
            {e.objects.length === 0 && !e.thought && <p className="quiet small">Everything from this message is in the Bin.</p>}
            {e.thought ? (
              <div className="stories"><a className="inbox-thought" href={`#/o/${e.thought.id}`}><Icon name="thought" /> Your comment is now a Thought: {e.thought.title}</a></div>
            ) : e.comment !== null || editing ? (
              <div className="inbox-comment">
                {editing ? (
                  <textarea autoFocus value={draft} rows={Math.max(2, draft.split("\n").length)} onChange={(x) => setDraft(x.target.value)} onBlur={saveComment}
                    onKeyDown={(x) => { if (x.key === "Escape") { setDraft(e.comment ?? ""); setEditing(false); } if (x.key === "Enter" && (x.metaKey || x.ctrlKey)) saveComment(); }} />
                ) : (
                  <p className="comment-text" title="Your words. Click to edit" onClick={() => setEditing(true)}>{e.comment}</p>
                )}
                <button className="pill action" onMouseDown={(x) => x.preventDefault()} onClick={toThought}>Turn into Thought</button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </li>
  );
}

/** #/inbox: the days that have phone captures. #/inbox/2026-11-05: one day. */
export function InboxPage({ day, types, version, onOpen, onChanged }: { day?: string; types: Types; version: number; onOpen: (id: string, ids: string[]) => void; onChanged: () => void }) {
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [entries, setEntries] = useState<InboxEntry[] | null>(null);
  const [tick, setTick] = useState(0);
  const again = useCallback(() => { setTick((t) => t + 1); onChanged(); }, [onChanged]);
  // Opening the inbox also looks in the Drive folder right away, so nothing waits for the half-minute check.
  useEffect(() => { inboxApi.inboxScan().then(setStatus).catch(() => inboxApi.inbox().then(setStatus)); }, [version, tick]);
  useEffect(() => { setEntries(null); if (day) inboxApi.inboxDay(day).then((r) => setEntries(r.entries)); }, [day, version, tick]);
  const dayNames = status?.days ?? [];
  const i = day ? dayNames.findIndex((d) => d.day === day) : -1;
  return (
    <main className="contents wrap inbox-page">
      <header className="vol">
        <h2>{day ? <><a className="quiet" href="#/inbox">Daily Inbox</a> · {dayLabel(day)}</> : "Daily Inbox"}</h2>
      </header>
      <p className="quiet small">Everything you sent from your phone that day, in the order you sent it. Things typed on the Mac aren’t here. Your comments stay here, in your words, until you turn one into a Thought.</p>
      {status && <Warning s={status} onChanged={setStatus} />}
      {!day && status && (
        status.days.length === 0
          ? <p className="quiet">Nothing has come from your phone yet.</p>
          : <ul className="inbox-days">{status.days.map((d) => (
              <li key={d.day}><a href={`#/inbox/${d.day}`}><strong>{dayLabel(d.day)}</strong> <span className="quiet">{d.count} {d.count === 1 ? "message" : "messages"}</span>{d.failed > 0 && <span className="inbox-warn"> · {d.failed} couldn’t be read</span>}</a></li>
            ))}</ul>
      )}
      {day && entries && entries.length === 0 && <p className="quiet">Nothing came from your phone on this day.</p>}
      {day && entries && entries.length > 0 && <ul className="inbox-list">{entries.map((e) => <Entry key={e.id} e={e} types={types} onOpen={onOpen} onChanged={again} />)}</ul>}
      {day && i >= 0 && (
        <p className="inbox-nav">
          {dayNames[i + 1] && <a href={`#/inbox/${dayNames[i + 1].day}`}>← {dayLabel(dayNames[i + 1].day)}</a>}
          {dayNames[i - 1] && <a href={`#/inbox/${dayNames[i - 1].day}`}>{dayLabel(dayNames[i - 1].day)} →</a>}
        </p>
      )}
    </main>
  );
}

/** On a Source: the owner's comment from the inbox. It is the same text as in the Daily Inbox, so editing here edits there. */
export function InboxCommentLine({ id, version }: { id: string; version?: number }) {
  const [c, setC] = useState<InboxComment>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => { inboxApi.inboxComment(id).then(setC).catch(() => setC(null)); }, [id, version]);
  if (!c) return null;
  const d = new Date(c.at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const save = async () => {
    setEditing(false);
    if (draft.trim() === c.comment) return;
    await inboxApi.inboxEdit(c.captureId, draft);
    setC(draft.trim() ? { ...c, comment: draft.trim() } : null);
  };
  return (
    <p className="inbox-source-comment small">
      <span className="quiet">Your comment from the inbox, <a href={`#/inbox/${c.day}`}>{d}</a>: </span>
      {editing
        ? <textarea autoFocus value={draft} rows={2} onChange={(e) => setDraft(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} />
        : <span className="comment-text" title="Click to edit" onClick={() => { setDraft(c.comment); setEditing(true); }}>{c.comment}</span>}
    </p>
  );
}
