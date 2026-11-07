// "From your Garden" on This week (issue #35) and the Questions list under More. Worked out on this Mac from dates and
// Connections; no AI, no counts, nothing overdue.
import { useEffect, useState } from "react";
import { api, type GardenItem, type QuestionsPage } from "./api";
import { Icon, formatDay, typeVar } from "./ui";

const HIDE_KEY = "garden-strip-hidden";
const today = () => new Date().toLocaleDateString("en-CA");
const hiddenToday = () => { try { return localStorage.getItem(HIDE_KEY) === today(); } catch { return false; } };

export function GardenStrip({ onOpen, version }: { onOpen: (id: string, ids: string[]) => void; version: number }) {
  const [items, setItems] = useState<GardenItem[] | null>(null);
  const [started, setStarted] = useState(0); // how many it began with
  const [hidden, setHidden] = useState(hiddenToday);
  useEffect(() => { api.garden().then((r) => { setItems(r.items); setStarted(r.items.length); }).catch(() => setItems([])); }, [version]);
  if (!items || !started || hidden) return null;
  const dismiss = (id: string) => { setItems((cur) => cur?.filter((x) => x.id !== id) ?? null); api.dismissGarden(id).catch(() => {}); };
  const hide = () => { try { localStorage.setItem(HIDE_KEY, today()); } catch { /* the strip just comes back next time */ } setHidden(true); };
  return (
    <aside className="garden-strip" aria-label="From your Garden">
      <div className="gs-head">
        <h3>From your Garden</h3>
        <button className="pill toggle" onClick={hide}>Hide for today</button>
      </div>
      {items.length === 0 && <p className="quiet small">That’s all for today. Tomorrow brings different ones.</p>}
      <ul>
        {items.map((i) => (
          <li key={i.id} style={typeVar(i.type)}>
            <span className="quiet small">{i.reason}</span>
            <button className="gs-open" onClick={() => onOpen(i.id, items.map((x) => x.id))}>
              <Icon name={i.type} /> <span>{i.title}</span>{i.private && <> <Icon name="lock" /></>}
            </button>
            <button className="x" aria-label={`Not today: ${i.title}`} title="Not today" onClick={() => dismiss(i.id)}><Icon name="close" /></button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function QuestionsPageView({ version }: { version: number }) {
  const [data, setData] = useState<QuestionsPage | null>(null);
  useEffect(() => { api.questions().then(setData); }, [version]);
  if (!data) return <main className="wrap contents"><p className="quiet">Opening…</p></main>;
  const row = (q: QuestionsPage["open"][number]) => (
    <li key={q.id} className="qrow">
      <a href={`#/o/${q.id}`}>{q.title}{q.private && <> <Icon name="lock" /></>}</a>
      <span className="quiet small">
        {q.state === "open" ? `Open since ${formatDay(q.openedAt)}` : `Settled for now · ${formatDay(q.settledAt!)}`}
        {q.settledBy && <> · by <a href={`#/o/${q.settledBy.id}`}>{q.settledBy.title}</a></>}
        {q.concepts.length > 0 && <> · in {q.concepts.map((c, i) => <span key={c.id}>{i > 0 && ", "}<a href={`#/o/${c.id}`}>{c.title}</a></span>)}</>}
      </span>
    </li>
  );
  return (
    <main className="wrap contents questions-page">
      <header className="vol"><h2>Questions <em>you mean to keep returning to</em></h2></header>
      <p className="quiet small">A Thought becomes an Open Question only when you mark it. There are no due dates and nothing is overdue.</p>
      <section className="ugroup">
        <div className="ugroup-h"><h3>Open</h3></div>
        {!data.open.length && <p className="quiet">No open questions. On any Thought, “+ Open Question” marks one.</p>}
        <ul className="qlist">{data.open.map(row)}</ul>
      </section>
      <section className="ugroup">
        <div className="ugroup-h"><h3>Settled for now</h3></div>
        {!data.settled.length && <p className="quiet">Nothing settled yet. A settled question can be reopened.</p>}
        <ul className="qlist">{data.settled.map(row)}</ul>
      </section>
    </main>
  );
}
