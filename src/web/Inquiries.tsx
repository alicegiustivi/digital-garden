// The Researcher on screen (issue #36): asking a question about one Object (the Ask tab, the Concept's Ask card) or the
// whole Garden, watching the real steps, coming back later, keeping an answer on Objects, and the Inquiries list.
// An answer is an AI Note: always marked, never editable, and it reaches an Object only through "Keep on…".
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, type Brief3, type Found, type InquiryRow, type Thread, type Turn } from "./api";
import { aiChanged, useAi } from "./Ai";
import { refresh } from "./refresh";
import { Markdown } from "./Markdown";
import { showToast } from "./toast";
import { Icon, formatDay, typeVar } from "./ui";

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** Buttons that depend on where the owner is. */
export const STARTERS: Record<string, string[]> = {
  concept: ["What here disagrees?", "What’s missing or one-sided?", "Suggest questions"],
  source: ["What are the main ideas here?", "Does this disagree with anything I’ve kept?", "Suggest questions"],
  thought: ["What supports this?", "What would challenge this?", "Suggest questions"],
  person: ["What have I connected to this person?", "What do they argue?", "Suggest questions"],
  garden: ["What have I been reading about lately?", "Where do my Sources disagree?", "What questions am I circling?"],
};

/** The answer's text: paragraphs, with each link to a real Object as a quiet link. */
export function AnswerText({ text, links }: { text: string; links: Record<string, { type: string; title: string; private: boolean }> }) {
  return (
    <Markdown text={text} mention={(id, key) => (links[id] ? <a key={key} className="ref" href={`#/o/${id}`} title={links[id].title}>{links[id].title}</a> : null)} />
  );
}

/** A thread reloads while any question in it is still on its way. */
function useThread(id: string): [Thread | null | undefined, () => void] {
  const [t, setT] = useState<Thread | null | undefined>(undefined);
  const load = () => { api.inquiry(id).then(setT).catch(() => setT(null)); };
  const active = t?.turns.some((x) => ["waiting", "working", "busy", "tomorrow"].includes(x.state));
  useEffect(() => { load(); }, [id]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [id, active]);
  useEffect(() => { window.addEventListener("garden-ai", load); return () => window.removeEventListener("garden-ai", load); }, [id]);
  return [t, load];
}

/** "Keep on…": the answer becomes an AI Note on the Objects picked. Private Objects can't hold AI text, so they aren't offered. */
function KeepPicker({ turn, thread, onDone }: { turn: Turn; thread: Thread; onDone: () => void }) {
  const a = turn.answer!;
  const options: Brief3[] = [...(thread.object ? [thread.object] : []), ...a.reads].filter((o, i, all) => !o.private && all.findIndex((x) => x.id === o.id) === i);
  const kept = new Set(a.kept.map((k) => k.id));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    let stale = false;
    api.search({ q, limit: 6 }).then((r) => { if (!stale) setFound(r.filter((x) => !x.private)); });
    return () => { stale = true; };
  }, [q]);
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const row = (id: string, type: string, title: string) => (
    <label key={id} className="keep-row" style={typeVar(type)}>
      <input type="checkbox" checked={picked.has(id)} disabled={kept.has(id)} onChange={() => toggle(id)} />
      <Icon name={type} /> <span>{title}</span>{kept.has(id) && <span className="quiet small"> · already kept here</span>}
    </label>
  );
  const keep = async () => {
    setError(undefined);
    try {
      const r = await api.keepTurn(turn.id, [...picked]);
      showToast(`Kept on ${r.kept.length === 1 ? `“${r.kept[0].title}”` : `${r.kept.length} Objects`}, as an AI Note.`);
      refresh(); aiChanged(); onDone();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div className="keep-picker" role="group" aria-label="Keep this answer on…">
      <p className="small quiet">Keep it as an AI Note beside the words of:</p>
      {options.map((o) => row(o.id, o.type, o.title))}
      <input className="keep-find" placeholder="Find another Object…" aria-label="Find another Object" value={q} onChange={(e) => setQ(e.target.value)} />
      {found.filter((f) => !options.some((o) => o.id === f.id)).map((f) => row(f.id, f.type, f.title))}
      {error && <p role="alert" className="small quiet">{error}</p>}
      <span className="acts">
        <button className="pill action" disabled={!picked.size} onClick={keep}>Keep</button>
        <button className="pill toggle" onClick={onDone}>Cancel</button>
      </span>
    </div>
  );
}

function TurnView({ turn, thread, reload }: { turn: Turn; thread: Thread; reload: () => void }) {
  const [keeping, setKeeping] = useState(false);
  const a = turn.answer;
  const act = (p: Promise<unknown>) => p.then(() => { reload(); aiChanged(); }).catch((e) => showToast(e.message));
  const thought = async () => { const t = await api.thoughtFromTurn(turn.id); refresh(); location.hash = `#/o/${t.id}`; };
  let status: ReactNode = null;
  if (turn.state === "waiting" || turn.state === "working") {
    status = turn.needsKey ? (
      <p className="turn-status">Saved. <a href="#/ai">Add your OpenRouter key</a> and it will start.</p>
    ) : (
      <>
        <ol className="steps-live" aria-label="What the Researcher is doing">
          {turn.state === "waiting" && !turn.steps.length && <li className="now">Waiting for its turn</li>}
          {turn.steps.map((s, i) => <li key={i} className={s.done ? "done" : i === turn.steps.findIndex((x) => !x.done) ? "now" : ""}>{s.label}</li>)}
        </ol>
        <p className="small"><button className="link-btn" onClick={() => act(api.cancelTurn(turn.id))}>Cancel</button></p>
      </>
    );
  } else if (turn.state === "busy") {
    status = (
      <p className="turn-status" role="status">
        The free AI is busy. Your question is saved, and I’ll try again at {clock(turn.nextTryAt!)}
        {turn.tries ? ` (try ${turn.tries + 1} of ${turn.maxTries})` : ""}. You can close this and come back. <button className="link-btn" onClick={() => act(api.cancelTurn(turn.id))}>Cancel</button>
      </p>
    );
  } else if (turn.state === "tomorrow") {
    status = (
      <p className="turn-status" role="status">
        Today’s free calls are used up. Your question is saved and will be asked after the count starts again ({new Date(turn.nextTryAt!).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}).{" "}
        <button className="link-btn" onClick={() => act(api.cancelTurn(turn.id))}>Cancel</button>
      </p>
    );
  } else if (turn.state === "cancelled") {
    status = <p className="turn-status quiet">{turn.error ?? "Cancelled."} <button className="link-btn" onClick={() => act(api.retryTurn(turn.id))}>Ask again</button></p>;
  } else if (turn.state === "failed") {
    status = <p className="turn-status" role="alert">{turn.error ?? "The Researcher couldn’t make an answer from this one."} <button className="link-btn" onClick={() => act(api.retryTurn(turn.id))}>Ask again</button></p>;
  }
  return (
    <section className="turn">
      <p className="turn-q"><span className="quiet small">You asked</span> {turn.question}</p>
      {status}
      {a && (
        <aside className="ai-note answer" aria-label="Researcher answer">
          <p className="label"><span className="o-ai-mark">✦</span> AI Note · Researcher answer · {a.date}</p>
          <div className="text" title={`Written by the ${a.role}, using ${a.model}, on ${a.date}`}><AnswerText text={a.text} links={a.links} /></div>
          {a.reads.length > 0 && (
            <p className="read-links small quiet">
              Read: {a.reads.map((r, i) => <span key={r.id}>{i > 0 && " · "}<a href={`#/o/${r.id}`} style={typeVar(r.type)}>{r.title}</a>{r.private ? <> <Icon name="lock" /></> : null}</span>)}
            </p>
          )}
          {a.web && (a.web.sources.length > 0 || a.web.notes.length > 0) && (
            <div className="web-sources small">
              {a.web.sources.length > 0 && <p className="quiet">From the web, outside your Garden:</p>}
              {a.web.sources.length > 0 && (
                <ol>
                  {a.web.sources.map((w) => <li key={w.n} value={w.n}><span className="o-src">{w.title}</span> — <a href={w.url} target="_blank" rel="noreferrer noopener">{w.site}</a></li>)}
                </ol>
              )}
              {a.web.notes.map((n, i) => <p key={i} className="quiet">{n}</p>)}
            </div>
          )}
          {a.privateNote && <p className="small quiet"><Icon name="lock" /> {a.privateNote}</p>}
          {a.kept.length > 0 && <p className="small quiet">Kept on: {a.kept.map((k, i) => <span key={k.id}>{i > 0 && ", "}<a href={`#/o/${k.id}`}>{k.title}</a></span>)}</p>}
          {keeping ? <KeepPicker turn={turn} thread={thread} onDone={() => { setKeeping(false); reload(); }} /> : (
            <span className="acts">
              <button className="link-btn" onClick={() => setKeeping(true)}>Keep on…</button>
              <button className="link-btn" onClick={thought}><Icon name="thought" /> Start a Thought from this</button>
            </span>
          )}
        </aside>
      )}
    </section>
  );
}

/** One Inquiry: its questions and answers, and a box for the next question. */
export function InquiryThread({ id, onGone }: { id: string; onGone?: () => void }) {
  const [t, reload] = useThread(id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (t === undefined) return <p className="quiet small">Opening…</p>;
  if (t === null) return <p className="quiet small">This question is no longer here.</p>;
  const follow = async () => {
    setBusy(true);
    try { await api.askAgain(id, text); setText(""); reload(); aiChanged(); } catch (e) { showToast((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    await api.deleteInquiry(id);
    refresh(); onGone?.();
    showToast("Question moved to the Bin. Answers you kept stay where they are.", async () => { await api.restoreInquiry(id); refresh(); });
  };
  return (
    <div className="inquiry">
      <p className="quiet small">
        {t.web ? "Web on · " : ""}{t.object ? <>About <a href={`#/o/${t.object.id}`} style={typeVar(t.object.type)}><Icon name={t.object.type} /> {t.object.title}</a></> : t.scopeGone ? "About an Object that is gone" : "Asked of the whole Garden"} · {formatDay(t.createdAt)}
      </p>
      {t.turns.map((turn) => <TurnView key={turn.id} turn={turn} thread={t} reload={reload} />)}
      <form className="follow" onSubmit={(e) => { e.preventDefault(); if (text.trim() && !busy) follow(); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a follow-up…" aria-label="Ask a follow-up" maxLength={1000} />
        <button className="pill action" disabled={!text.trim() || busy}>Ask</button>
      </form>
      <p className="small"><button className="link-btn" onClick={remove}>Delete this question</button></p>
    </div>
  );
}

/** The box and starter buttons. `objectId` is the Object asked about; none means the whole Garden. */
export function AskBox({ objectId, type, onAsked }: { objectId?: string; type: string; onAsked: (inquiryId: string) => void }) {
  const ai = useAi();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [web, setWeb] = useState(false); // off unless turned on for this question (ADR 0009)
  const go = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    try { const t = await api.ask(q, objectId, web); setText(""); aiChanged(); onAsked(t.id); } catch (e) { showToast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="askbox">
      <div className="asks">
        {(STARTERS[objectId ? type : "garden"] ?? STARTERS.source).map((q) => <button key={q} className="pill action" disabled={busy} onClick={() => go(q)}>{q}</button>)}
      </div>
      <form className="follow" onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={objectId ? "Ask about this…" : "Ask the Garden…"} aria-label="Your question" maxLength={1000} />
        <button className="pill action" disabled={!text.trim() || busy}>Ask</button>
      </form>
      {ai && !ai.keySet && <p className="small quiet">The Researcher needs your OpenRouter key. <a href="#/ai">Add it</a>; a question asked now is saved and starts once it’s there.</p>}
      {ai?.keySet && ai.low && <p className="small warn" role="status">Only {ai.left} free calls are left today (each question uses two). The count starts again at {new Date(ai.reset.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.</p>}
      <label className="small web-switch">
        <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} /> Also look on the web for this question
      </label>
      <p className="small quiet">{web
        ? "Only the titles of up to three Objects it reads (never their text, Tags or Connections, and never a Private one) are sent to Wikipedia and Wikidata. The answer keeps what comes from your Garden apart from what comes from the web."
        : "Off: nothing leaves this Mac except the AI request."}</p>
      <p className="small quiet">Each question uses two of today’s free calls. It reads only what isn’t Private, and never treats an earlier answer as evidence.</p>
    </div>
  );
}

const STATE_WORD: Record<Turn["state"], string> = { waiting: "waiting", working: "working", busy: "waiting (AI busy)", tomorrow: "waiting for tomorrow", failed: "not answered", cancelled: "cancelled", done: "answered" };

/** Ask about one Object: the starter buttons, a box, and the questions already asked about it. */
export function AskPanel({ objectId, type, isPrivate, compact }: { objectId: string; type: string; isPrivate: boolean; compact?: boolean }) {
  const [rows, setRows] = useState<InquiryRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = () => api.inquiriesAbout(objectId).then(setRows).catch(() => {});
  useEffect(() => { setOpenId(null); load(); }, [objectId]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, [objectId]);
  if (isPrivate) return <p className="quiet small"><Icon name="lock" /> Private: the Researcher never reads this, so there is nothing to ask.</p>;
  return (
    <div className={`ask-panel ${compact ? "compact" : ""}`}>
      <AskBox objectId={objectId} type={type} onAsked={(id) => { setOpenId(id); load(); }} />
      {rows.length > 0 && (
        <ul className="inq-list">
          {rows.map((r) => (
            <li key={r.id}>
              <details open={openId === r.id} onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) setOpenId(r.id); else if (openId === r.id) setOpenId(null); }}>
                <summary><span>{r.question}</span> <span className="quiet small">· {STATE_WORD[r.state]} · {formatDay(r.createdAt)}</span></summary>
                {openId === r.id && <InquiryThread id={r.id} onGone={() => { setOpenId(null); load(); }} />}
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Inquiries: ask the whole Garden, and find every question again. */
export function InquiriesPage({ version }: { version: number }) {
  const [rows, setRows] = useState<InquiryRow[] | null>(null);
  const load = () => api.inquiries().then(setRows).catch(() => setRows([]));
  useEffect(() => { load(); }, [version]);
  useEffect(() => {
    const t = setInterval(load, 5000);
    window.addEventListener("garden-ai", load);
    return () => { clearInterval(t); window.removeEventListener("garden-ai", load); };
  }, []);
  const top = useRef<HTMLElement>(null);
  return (
    <main className="wrap contents inquiries-page" ref={top}>
      <header className="vol"><h2>Inquiries <em>questions you’ve asked the Researcher</em></h2></header>
      <section className="dcard ask">
        <h3>Ask the Garden</h3>
        <AskBox type="garden" onAsked={(id) => { location.hash = `#/inquiry/${id}`; }} />
      </section>
      {rows && !rows.length && <p className="quiet">Nothing asked yet. A question you ask, about one Object or the whole Garden, is kept here with its answers.</p>}
      <ul className="inq-rows">
        {rows?.map((r) => (
          <li key={r.id}>
            <a href={`#/inquiry/${r.id}`}>{r.question}</a>
            <span className="quiet small">
              {r.object ? <>about <a href={`#/o/${r.object.id}`} style={typeVar(r.object.type)}>{r.object.title}</a></> : r.scopeGone ? "about an Object that is gone" : "whole Garden"} · {STATE_WORD[r.state]}
              {r.turns > 1 ? ` · ${r.turns} questions` : ""} · {formatDay(r.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** One Inquiry on its own page. */
export function InquiryPage({ id }: { id: string }) {
  return (
    <main className="wrap contents inquiries-page">
      <p className="small"><a href="#/inquiries">← Inquiries</a></p>
      <InquiryThread id={id} onGone={() => { location.hash = "#/inquiries"; }} />
    </main>
  );
}
