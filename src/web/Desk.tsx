// The Concept page as a Distill desk (issue #35): Open Questions and Tensions on the left, the owner's view in the middle,
// Ask and the Connection groups on the right. Everything on it is worked out on this Mac; no AI is called.
import { useEffect, useState, type ReactNode } from "react";
import { api, type Desk, type Question, type Types } from "./api";
import { openLink } from "./Connections";
import { markMade } from "./fresh";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { AskPanel } from "./Inquiries";
import { Icon, formatDay, typeVar } from "./ui";

/** The desk's numbers, reloaded whenever something on screen changes. */
export function useDesk(id: string | null): Desk | null {
  const tick = useRefresh();
  const [desk, setDesk] = useState<Desk | null>(null);
  useEffect(() => {
    if (!id) { setDesk(null); return; }
    api.desk(id).then(setDesk).catch(() => setDesk(null));
  }, [id, tick]);
  return desk;
}

const BIG = 20; // above this many Objects, the type filter and "Show all" appear
const CUT = 6; // rows a group shows before "Show all"
const dayText = (day: string) => formatDay(`${day}T12:00:00`);

/** In the cover: how many Objects are connected, split by type, and since when. */
export function DeskSummary({ desk, types }: { desk: Desk | null; types: Types }) {
  if (!desk) return null;
  const parts = Object.entries(desk.mix).map(([k, n]) => {
    const t = types.types.find((x) => x.key === k);
    return `${n} ${(n === 1 ? t?.label : t?.plural)?.toLowerCase() ?? k}`;
  });
  return (
    <div className="desk-sum">
      <p className="small">
        <strong>{desk.total} {desk.total === 1 ? "Object" : "Objects"}</strong> connected{parts.length ? ` · ${parts.join(" · ")}` : ""}
      </p>
      {desk.total > 0 && (
        <div className="mixbar" aria-hidden="true">
          {Object.entries(desk.mix).map(([k, n]) => <span key={k} style={{ ...typeVar(k), flex: n }} />)}
        </div>
      )}
    </div>
  );
}

function QuestionLine({ q, beside }: { q: Question; beside: (id: string) => void }) {
  return (
    <li className={`dq ${q.state}`}>
      <a href={`#/o/${q.id}`} onClick={openLink(q.id, beside)}>{q.title}{q.private && <> <Icon name="lock" /></>}</a>
      <span className="quiet small">
        {q.state === "open" ? `Open since ${formatDay(q.openedAt)} · last touched ${formatDay(q.touchedAt)}` : `Settled for now · ${formatDay(q.settledAt!)}`}
        {q.settledBy && <> · by <a href={`#/o/${q.settledBy.id}`} onClick={openLink(q.settledBy.id, beside)}>{q.settledBy.title}</a></>}
      </span>
    </li>
  );
}

function ThoughtAbout({ a, b, go }: { a: string; b: string; go?: () => void }) {
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try {
      const { id } = await api.thoughtAbout(a, b);
      markMade(id);
      refresh();
      go?.();
      location.hash = `#/o/${id}`;
    } catch (e) { showToast((e as Error).message); setBusy(false); }
  };
  return <button className="pill action" disabled={busy} onClick={make}><Icon name="thought" /> Write a Thought about these</button>;
}
export { ThoughtAbout };

function Group({ g, filter, big, beside }: { g: Desk["groups"][number]; filter: string; big: boolean; beside: (id: string) => void }) {
  const items = filter ? g.items.filter((i) => i.type === filter) : g.items;
  const [all, setAll] = useState(false);
  const shown = big && !all ? items.slice(0, CUT) : items;
  return (
    <details className="dgroup" open={items.length > 0}>
      <summary><span>{g.label}</span> <em>{items.length}</em></summary>
      {items.length === 0 && <p className="quiet small">Nothing here yet.</p>}
      <ul>
        {shown.map((r) => (
          <li key={r.connectionId} style={typeVar(r.type)}>
            <Icon name={r.type} />
            <a href={`#/o/${r.id}`} onClick={openLink(r.id, beside)} title="⌥-click opens it beside this one">{r.title}</a>
            {r.private && <span title="Private: no AI reads this"><Icon name="lock" /></span>}
            {r.approved && <span className="o-ai-mark" title="A Suggestion you approved. It stays the AI's">✧</span>}
            {g.key === "related" && r.kind !== "related" && <span className="quiet small">{r.label}</span>}
            {g.key !== "related" && /^(supported|built)/.test(r.label) && <span className="quiet small">{r.label}</span>}
            <span className="quiet small grow-r">{formatDay(r.changedAt)}</span>
          </li>
        ))}
      </ul>
      {big && items.length > CUT && <button className="pill toggle" onClick={() => setAll(!all)}>{all ? `Show fewer` : `Show all ${items.length}`}</button>}
    </details>
  );
}

/** The three columns. `view` is the owner's editor, built by the page so it saves like every other body. */
export function ConceptDesk({ desk, types, beside, view, id, isPrivate }: { desk: Desk | null; types: Types; beside: (id: string) => void; view: ReactNode; id: string; isPrivate: boolean }) {
  const [filter, setFilter] = useState("");
  const [versions, setVersions] = useState(false);
  useEffect(() => setFilter(""), [desk?.id]);
  const big = (desk?.total ?? 0) > BIG;
  const types2 = desk ? Object.keys(desk.mix) : [];
  const openQs = desk?.questions ?? [];
  return (
    <div className="desk-wrap"><div className="desk">
      <aside className="desk-left" aria-label="To think about">
        <section className="dcard">
          <h3>Open questions</h3>
          {openQs.length ? <ul className="dqs">{openQs.map((q) => <QuestionLine key={q.id} q={q} beside={beside} />)}</ul>
            : <p className="quiet small">Any Thought connected to this Concept can become one.</p>}
        </section>
        <section className="dcard">
          <h3>Tensions</h3>
          {desk?.tensions.length ? (
            <ul className="dtens">
              {desk.tensions.map((t) => (
                <li key={t.connectionId}>
                  <div className="pair">
                    <a href={`#/o/${t.a.id}`} style={typeVar(t.a.type)} onClick={openLink(t.a.id, beside)}><Icon name={t.a.type} /> {t.a.title}</a>
                    <span className="quiet small">contradicts</span>
                    <a href={`#/o/${t.b.id}`} style={typeVar(t.b.type)} onClick={openLink(t.b.id, beside)}><Icon name={t.b.type} /> {t.b.title}</a>
                  </div>
                  <ThoughtAbout a={t.a.id} b={t.b.id} />
                </li>
              ))}
            </ul>
          ) : <p className="quiet small">When two things in this Concept contradict each other, the pair shows up here.</p>}
        </section>
      </aside>

      <section className="desk-mid" aria-label="Your view">
        <div className="sheet">
          {view}
          {desk && !desk.versions.length && <p className="quiet small view-hint">Leaving it empty is fine.</p>}
        </div>
        <div className="vfoot">
          <button className="pill toggle" aria-expanded={versions} onClick={() => setVersions(!versions)} disabled={!desk?.versions.length}>
            Your view over time · {desk?.versions.length ?? 0} {desk?.versions.length === 1 ? "version" : "versions"}
          </button>
          <span className="quiet small">One a day at most, kept as you leave your words.</span>
        </div>
        {versions && desk && (
          <ol className="versions">
            {desk.versions.map((v) => (
              <li key={v.day}>
                <h4>{dayText(v.day)}</h4>
                {v.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="desk-right" aria-label="Ask and Connections">
        <section className="dcard ask">
          <h3>Ask</h3>
          <AskPanel objectId={id} type="concept" isPrivate={isPrivate} compact />
          <p className="quiet small">Answers stay in Inquiries and never stand in for your view.</p>
          {!!desk?.privateCount && <p className="quiet small"><Icon name="lock" /> {desk.privateCount} Private {desk.privateCount === 1 ? "Object" : "Objects"} here {desk.privateCount === 1 ? "is" : "are"} never sent to the AI.</p>}
        </section>
        <section className="dcard">
          <div className="dhead">
            <h3>In this Concept</h3>
            {!!desk?.suggested && (
              <button className="pill toggle" onClick={() => document.querySelector(".archivist-block")?.scrollIntoView({ behavior: "smooth", block: "center" })}>✦ {desk.suggested} suggested</button>
            )}
          </div>
          {big && (
            <div className="dfilter" role="group" aria-label="Show only one type">
              <button className={`pill toggle ${filter === "" ? "on" : ""}`} onClick={() => setFilter("")}>All</button>
              {types2.map((k) => (
                <button key={k} className={`pill toggle ${filter === k ? "on" : ""}`} onClick={() => setFilter(k)}>{types.types.find((t) => t.key === k)?.plural ?? k}</button>
              ))}
            </div>
          )}
          {desk?.groups.map((g) => <Group key={g.key} g={g} filter={filter} big={big} beside={beside} />)}
        </section>
      </aside>
    </div></div>
  );
}

/** On a Thought: the owner's switch for "I mean to keep returning to this". Settled for now keeps its date and can be reopened. */
export function OpenQuestionControl({ id, beside }: { id: string; beside: (id: string) => void }) {
  const tick = useRefresh();
  const [q, setQ] = useState<Question | null | undefined>(undefined);
  const [settling, setSettling] = useState(false);
  const [choices, setChoices] = useState<{ id: string; title: string }[]>([]);
  const [by, setBy] = useState("");
  useEffect(() => { api.question(id).then(setQ).catch(() => setQ(null)); }, [id, tick]);
  useEffect(() => {
    if (!settling) return;
    api.connections(id).then((rows) => setChoices(rows.filter((c) => c.other.type === "thought").map((c) => ({ id: c.other.id, title: c.other.title }))));
  }, [settling, id]);
  const set = (state: "open" | "settled" | "none", settledBy?: string) =>
    api.setQuestion(id, state, settledBy).then((r) => { setQ(r); setSettling(false); setBy(""); refresh(); }).catch((e) => showToast(e.message));
  if (q === undefined) return null;
  if (!q)
    return <button className="pill ghost" title="Mark this Thought as a question you mean to keep returning to" onClick={() => set("open")}>+ Open Question</button>;
  return (
    <span className="oq">
      <span className={`pill ${q.state === "open" ? "oq-open" : ""}`}>
        <span className="k">{q.state === "open" ? "Open Question" : "Settled for now"}</span>
        {q.state === "open" ? `since ${formatDay(q.openedAt)}` : formatDay(q.settledAt!)}
        {q.settledBy && <> · <a href={`#/o/${q.settledBy.id}`} onClick={openLink(q.settledBy.id, beside)}>{q.settledBy.title}</a></>}
      </span>
      {q.state === "open" && !settling && <button className="pill action" onClick={() => setSettling(true)}>Settled for now</button>}
      {q.state === "open" && settling && (
        <span className="confirm">
          <select value={by} aria-label="The Thought that settled it (optional)" onChange={(e) => setBy(e.target.value)}>
            <option value="">No Thought points to the answer</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <button className="pill action" onClick={() => set("settled", by || undefined)}>Settle</button>
          <button className="pill toggle" onClick={() => setSettling(false)}>Cancel</button>
        </span>
      )}
      {q.state === "settled" && <button className="pill action" onClick={() => set("open")}>Reopen</button>}
      <button className="pill toggle" title="It stops being an Open Question; the Thought stays" onClick={() => set("none")}>Not a question</button>
    </span>
  );
}
