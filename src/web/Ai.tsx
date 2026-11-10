import { useEffect, useState } from "react";
import { api, type AiStatus, type AiSummary, type Obj } from "./api";
import { Hint, Icon } from "./ui";

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Reloads the AI summary now and then, and whenever something says it changed. */
export function useAi(every = 15000) {
  const [ai, setAi] = useState<AiSummary | null>(null);
  useEffect(() => {
    const load = () => api.ai().then(setAi).catch(() => {});
    load();
    const t = setInterval(load, every);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, [every]);
  return ai;
}
export const aiChanged = () => window.dispatchEvent(new Event("garden-ai"));

/** The quiet AI line in the top bar. */
export function AiLine({ on }: { on?: boolean } = {}) {
  const ai = useAi();
  if (!ai) return null;
  const text = !ai.keySet ? "AI · add your key" : ai.keyProblem ? "AI · key needs attention" : `AI · ${ai.low ? `only ${ai.left} calls left today` : `${ai.left} calls left`}${ai.waiting ? ` · ${ai.waiting} waiting` : ""}`;
  return <a className={`side-link ai-line${on ? " on" : ""} ${ai.keySet && !ai.keyProblem && !ai.low ? "" : "attn"}`} href="#/ai" title="Today's free AI allowance, shared by the Archivist and the Researcher"><Icon name="ai" /><span className="side-label">{text}</span></a>;
}

const statusText = (st: AiStatus): string =>
  st.state === "private" ? "Private, not read"
  : st.state === "working" ? "Working"
  : st.state === "busy" ? `Waiting for a free model (trying again at ${clock(st.nextTryAt!)})`
  : st.state === "tomorrow" ? "Waiting until tomorrow"
  : st.state === "failed" ? "Couldn't read this"
  : st.state === "done" ? "Done" : "Waiting";

/** The one-line Archivist status under a capture in the Unreviewed list. */
export function CardStatus({ id, private: priv }: { id: string; private: boolean }) {
  const [st, setSt] = useState<AiStatus | null>(null);
  useEffect(() => {
    const load = () => api.aiStatus(id).then(setSt).catch(() => {});
    load();
    const t = setInterval(load, 6000);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, [id]);
  const text = st ? statusText(st) : priv ? "Private, not read" : "Waiting";
  const n = st?.pending ?? 0;
  return <>Archivist: {st?.state === "none" ? "not asked yet" : text}{!!st?.run?.connections && <> · {st.run.connections} {st.run.connections === 1 ? "Connection" : "Connections"} added <button className="link-btn" onClick={() => api.aiUndo(id).then(() => api.aiStatus(id)).then(setSt).then(aiChanged)}>Undo</button></>}{n > 0 && <> · {n} {n === 1 ? "Suggestion" : "Suggestions"}</>}{st?.state === "failed" && <> · <button className="link-btn" onClick={() => api.aiRun(id).then(setSt).then(aiChanged)}>Retry</button></>}</>;
}

/** What the Archivist is doing with this Object, and its marked work with one-click Undo. */
export function AiStatusLine({ id, onChanged }: { id: string; onChanged: (o: Obj) => void }) {
  const [st, setSt] = useState<AiStatus | null>(null);
  const load = () => api.aiStatus(id).then(setSt).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, [id]);
  // When the Archivist finishes while the page is open, show what it added.
  const [seen, setSeen] = useState<string>();
  useEffect(() => {
    const key = st?.state === "done" ? String(st.run?.id ?? "x") : undefined;
    if (key && seen !== undefined && seen !== key) api.get(id).then(onChanged).catch(() => {});
    if (st) setSeen(key ?? "");
  }, [st?.state, st?.run?.id]);
  if (!st) return null;
  if (st.state === "none" && !st.run) return <NoJob id={id} reload={load} />;
  const retry = () => api.aiRun(id).then(setSt).then(aiChanged);
  const undo = async () => { onChanged(await api.aiUndo(id)); load(); };
  let line: React.ReactNode = null;
  if (st.state === "waiting" && st.needsKey) line = <>Waiting · <a href="#/ai">add your OpenRouter key</a> to start</>;
  else if (st.state === "failed") line = <>Couldn’t read this · <button className="link-btn" onClick={retry}>Retry</button></>;
  else if (st.state !== "done") line = statusText(st);
  const again = st.state === "done" && st.canRun;
  return (
    <div className="ai-status small quiet" role="status">
      {line && st.state !== "none" && <p><span className="o-ai-mark">✦</span> Archivist: {line}</p>}
      {again && <p><button className="link-btn" onClick={retry} title="Uses one or two of today’s calls. Anything you rejected stays rejected.">Ask the Archivist again</button></p>}
      {st.run && (st.run.facts.length > 0 || st.run.tags.length > 0 || st.run.connections > 0) && (
        <p>
          <span className="o-ai-mark">✦</span> The Archivist added {[st.run.facts.length ? `${st.run.facts.join(", ")}` : "", st.run.tags.length ? `${st.run.tags.length === 1 ? "a Tag" : st.run.tags.length + " Tags"}` : "", st.run.connections ? `${st.run.connections} ${st.run.connections === 1 ? "Connection" : "Connections"}` : ""].filter(Boolean).join(" and ")}.{" "}
          <button className="link-btn" onClick={undo}>Undo</button>
        </p>
      )}
    </div>
  );
}
function NoJob({ id, reload }: { id: string; reload: () => void }) {
  return (
    <div className="ai-status small quiet">
      <button className="link-btn" onClick={() => api.aiRun(id).then(reload).then(aiChanged)}>Let the Archivist look now</button> <span title="Uses one or two of today’s calls">(one or two calls)</span>
    </div>
  );
}

/** More ▸ AI: the key, the day's allowance, and what is queued. */
export function AiPage() {
  const ai = useAi(5000);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError(undefined);
    try { await api.saveAiKey(key.trim()); setKey(""); aiChanged(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <main className="contents wrap ai-page">
      <header className="vol"><h2>AI</h2></header>
      <Hint short="Your OpenRouter key and today’s free AI allowance. The AI never reads Private Objects and never writes in your words.">
      <p>The Researcher answers questions you ask it, about one Object or the whole Garden; its answers are AI Notes that stay in Inquiries until you keep one on an Object. The Archivist reads each new capture and fills in what it can: the kind of thing it is, who wrote it, when, and a few Tags. Tags and facts it adds are marked ✦ and can be undone in one click. Connections it finds (related, or authored by) are added the same way, marked ✦ with their own Undo. A more specific Connection (supports, contradicts, builds on, inspired by), a change of type and new Objects wait on the Object as Suggestions until you approve them (then they show ✧). A short summary of a Source appears as an AI Note beside your words, never inside them. It never reads anything you marked Private, and it never writes in your words.</p>
      </Hint>

      <h3>Your OpenRouter key</h3>
      {ai?.keySet && !ai.keyProblem ? (
        <p>A key is saved on this Mac. <button className="pill toggle" onClick={() => api.forgetAiKey().then(aiChanged)}>Remove it</button></p>
      ) : (
        <>
          {ai?.keyProblem && <p role="alert">OpenRouter is not accepting the saved key. Paste a new one.</p>}
          <ol className="steps">
            <li>Go to <a href="https://openrouter.ai/sign-up" target="_blank" rel="noreferrer">openrouter.ai</a> and make a free account.</li>
            <li>For about 1,000 free calls a day instead of 50, buy the smallest amount of credit they offer (a few dollars). The Garden only ever uses free models, so it never spends that credit.</li>
            <li>Open <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer">Settings ▸ Keys</a>, press “Create key”, and copy it. It starts with <code>sk-or-</code>.</li>
            <li>Paste it here and press Save.</li>
          </ol>
          <form className="key-form" onSubmit={(e) => { e.preventDefault(); if (key.trim() && !busy) save(); }}>
            <input type="password" autoComplete="off" spellCheck={false} placeholder="sk-or-…" value={key} onChange={(e) => setKey(e.target.value)} aria-label="OpenRouter key" />
            <button className="pill action" disabled={!key.trim() || busy}>{busy ? "Checking…" : "Save key"}</button>
          </form>
          {error && <p role="alert" className="quiet small">{error}</p>}
          <p className="quiet small">The key is kept in a private file in your Garden folder on this Mac. It is not in the Garden’s database, so it is never in a Backup or Export.</p>
        </>
      )}

      {ai && (
        <>
          <h3>Today</h3>
          <ul className="plain">
            <li>Archivist: {ai.budgets.archivist.used} of {ai.budgets.archivist.limit} calls used</li>
            <li>Researcher: {ai.budgets.researcher.used} of {ai.budgets.researcher.limit} calls used</li>
            <li>Waiting in the queue: {ai.waiting}</li>
            <li>The count starts again at {new Date(ai.reset.at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} here ({ai.reset.source}).</li>
            <li>Models, in order: {ai.models.join(", ")}</li>
          </ul>
          <p className="quiet small">When a free model is busy the Archivist simply waits and tries again (after 1, 5, 15 and 30 minutes, then every hour). If the Mac is off, the work waits for it.</p>
        </>
      )}
    </main>
  );
}
