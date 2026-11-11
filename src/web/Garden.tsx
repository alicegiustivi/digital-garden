// "From your Garden" on This week (issue #35) and the Questions list under More. Worked out on this Mac from dates and
// Connections; no AI, no counts, nothing overdue.
import { useEffect, useState } from "react";
import { api, type GardenItem, type QuestionsPage } from "./api";
import { Hint, Icon, formatDay, typeVar } from "./ui";

const HIDE_KEY = "garden-strip-hidden";
const today = () => new Date().toLocaleDateString("en-CA");
const hiddenToday = () => { try { return localStorage.getItem(HIDE_KEY) === today(); } catch { return false; } };

// What the strip says when there is nothing to show yet (issue #154). Always the same quiet line; no count, no task.
export const GARDEN_STRIP_EMPTY = "Older things will come back here once your Garden has a few weeks behind it.";
export const GARDEN_STRIP_DONE = "That’s all for today. Tomorrow brings different ones.";

// The strip is always on the page so its space is kept (issue #154). `wide` is the Overview's row across the top.
export function GardenStrip({ onOpen, version, wide = false }: { onOpen: (id: string, ids: string[]) => void; version: number; wide?: boolean }) {
  const [items, setItems] = useState<GardenItem[] | null>(null);
  const [started, setStarted] = useState(0); // how many it began with
  const [hidden, setHidden] = useState(hiddenToday);
  useEffect(() => { api.garden().then((r) => { setItems(r.items); setStarted(r.items.length); }).catch(() => { setItems([]); setStarted(0); }); }, [version]);
  const cls = `garden-strip${wide ? " wide" : ""}`;
  const dismiss = (id: string) => { setItems((cur) => cur?.filter((x) => x.id !== id) ?? null); api.dismissGarden(id).catch(() => {}); };
  const hide = () => { try { localStorage.setItem(HIDE_KEY, today()); } catch { /* the strip just comes back next time */ } setHidden(true); };
  const show = () => { try { localStorage.removeItem(HIDE_KEY); } catch { /* ignore */ } setHidden(false); };
  if (hidden) {
    return (
      <aside className={`${cls} folded`} aria-label="From your Garden">
        <div className="gs-head">
          <h3>From your Garden</h3>
          <button className="pill toggle" onClick={show}>Show</button>
        </div>
      </aside>
    );
  }
  return (
    <aside className={cls} aria-label="From your Garden">
      <div className="gs-head">
        <h3>From your Garden</h3>
        <button className="pill toggle" onClick={hide}>Hide for today</button>
      </div>
      {items && !started && <p className="quiet small">{GARDEN_STRIP_EMPTY}</p>}
      {items && started > 0 && items.length === 0 && <p className="quiet small">{GARDEN_STRIP_DONE}</p>}
      <ul>
        {(items ?? []).map((i) => (
          <li key={i.id} style={typeVar(i.type)}>
            <span className="quiet small">{i.reason}</span>
            <button className="gs-open" onClick={() => onOpen(i.id, items!.map((x) => x.id))}>
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
      <Hint short="Thoughts you mean to keep returning to.">
        <p>A Thought becomes an Open Question only when you mark it. There are no due dates and nothing is overdue.</p>
      </Hint>
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
