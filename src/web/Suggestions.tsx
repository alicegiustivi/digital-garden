import { useEffect, useState } from "react";
import { api, type AiNote, type Obj, type Suggestion, type Suggestions, type Types } from "./api";
import { aiChanged } from "./Ai";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { Icon, Marked, formatDay, typeVar } from "./ui";

/** Reloads when something says the AI or the Connections changed, and now and then while the page is open. */
function useLive(load: () => void, deps: unknown[], every = 5000) {
  const tick = useRefresh();
  useEffect(() => {
    load();
    const t = setInterval(load, every);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, [...deps, tick]);
}

const wording = (s: Suggestion, types: Types, current: string): React.ReactNode => {
  const label = (key: string) => types.types.find((t) => t.key === key)?.label ?? key;
  if (s.kind === "connection")
    return <>Connect to <a href={`#/o/${s.other.id}`} className="sg-obj" style={typeVar(s.other.type)}>{s.other.title}</a> <span className="quiet small">({label(s.other.type)}) as {s.connectionKind}</span></>;
  if (s.kind === "type") return <>Change this from a {label(current)} to a {s.typeLabel}</>;
  if (s.kind === "object") return <>Add a new {s.typeLabel}, <b>{s.name}</b>{current === "source" ? <span className="quiet small"> (authored by)</span> : null}</>;
  return <>Use “{s.title}” as the title</>;
};

/**
 * "From the Archivist" (CONTEXT.md: Suggestion). Each Suggestion waits here, apart from the owner's own Connections, until it is
 * approved (it keeps AI Origin, marked ✧) or rejected (remembered, not proposed again unless the owner asks).
 */
export function ArchivistSuggestions({ obj, types, onChanged }: { obj: Obj; types: Types; onChanged: (o: Obj) => void }) {
  const [s, setS] = useState<Suggestions | null>(null);
  const load = () => { api.suggestions(obj.id).then(setS).catch(() => {}); };
  useLive(load, [obj.id, obj.private]);
  const [error, setError] = useState<string>();

  if (obj.private) {
    return (
      <>
        <p className="quiet small">Private: no AI reads this.</p>
        {obj.aiReadBeforePrivate && <p className="quiet small">AI read this before it became Private on {formatDay(obj.aiReadBeforePrivate)}.</p>}
      </>
    );
  }
  if (!s || (!s.pending.length && !s.rejected)) return null;

  const approve = async (x: Suggestion) => {
    setError(undefined);
    try { onChanged(await api.approve(x.id)); refresh(); load(); }
    catch (e) { setError((e as Error).message); load(); }
  };
  const reject = async (x: Suggestion) => {
    setError(undefined);
    try { await api.reject(x.id); load(); showToast("Rejected. The Archivist won’t propose it again."); }
    catch (e) { setError((e as Error).message); }
  };
  const allowAgain = async () => { await api.forgetRejected(obj.id); load(); showToast("Rejected ideas can be proposed again, the next time the Archivist looks."); };

  return (
    <section className="archivist-block" aria-label="From the Archivist">
      <h3><span className="o-ai-mark">✦</span> From the Archivist</h3>
      {s.pending.length > 0 && (
        <ul>
          {s.pending.map((x) => (
            <li key={x.id} title={`Suggested by the ${x.aiRole}, using ${x.aiModel}, on ${x.aiDate}`}>
              <span>{wording(x, types, obj.type)}</span>
              <span className="acts">
                <button className="pill action" onClick={() => approve(x)}>Approve</button>
                <button className="pill toggle" onClick={() => reject(x)}>Reject</button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="quiet small">{error}</p>}
      {s.rejected > 0 && (
        <p className="quiet small">
          {s.rejected} rejected {s.rejected === 1 ? "idea is" : "ideas are"} remembered. <button className="link-btn" onClick={allowAgain}>Let the Archivist propose {s.rejected === 1 ? "it" : "them"} again</button>
        </p>
      )}
    </section>
  );
}

/** AI Notes beside the body: read-only, always marked, deletable, and the only way forward is the owner's own Thought. */
export function AiNotes({ obj }: { obj: Pick<Obj, "id" | "private"> }) {
  const [notes, setNotes] = useState<AiNote[]>([]);
  const load = () => { api.aiNotes(obj.id).then(setNotes).catch(() => {}); };
  useLive(load, [obj.id, obj.private], 6000);
  if (obj.private || !notes.length) return null;

  const remove = async (n: AiNote) => {
    const { was } = await api.deleteAiNote(n.id);
    load();
    showToast("AI Note deleted.", async () => { await api.restoreAiNote(was); load(); });
  };
  const startThought = async (n: AiNote) => {
    const t = await api.thoughtFromNote(n.id);
    refresh();
    location.hash = `#/o/${t.id}`;
  };

  return (
    <section className="ai-notes" aria-label="AI Notes">
      {notes.map((n) => (
        <aside key={n.id} className="ai-note">
          <p className="label">
            <Marked o={n}>AI Note</Marked> · {n.kind === "prompt" ? "the note this Thought started from" : "summary"} · {n.aiRole}, {n.aiDate}
          </p>
          <p className="text" title={`Written by the ${n.aiRole}, using ${n.aiModel}, on ${n.aiDate}`}>{n.text}</p>
          <span className="acts">
            {n.kind === "summary" && <button className="link-btn" onClick={() => startThought(n)}><Icon name="thought" /> Start a Thought from this</button>}
            <button className="link-btn" onClick={() => remove(n)}>Delete</button>
          </span>
        </aside>
      ))}
    </section>
  );
}
