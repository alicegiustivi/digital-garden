// Search (issue #33): the ⌘K window and the full Search page. Private Objects are found and shown with a lock.
import { Fragment, useEffect, useRef, useState } from "react";
import { api, type FindResult, type Hit, type Types } from "./api";
import { FilterBar, noFilters, useFilterQuery, useSort, type FilterState } from "./Filters";
import { recentIds } from "./recent";
import { Icon, Marked, TagPill, formatDay, typeVar } from "./ui";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The text with the words that matched picked out. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  return (
    <>
      {(text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu) ?? [text]).map((t, i) =>
        /^[\p{L}\p{N}]/u.test(t) && terms.some((w) => fold(t).startsWith(w)) ? <mark key={i}>{t}</mark> : <Fragment key={i}>{t}</Fragment>,
      )}
    </>
  );
}

/** The matching sentence with its Origin mark, and where it was found. */
function MatchLine({ hit, terms }: { hit: Hit; terms: string[] }) {
  const m = hit.match;
  if (!m || m.where === "title") return null;
  return (
    <p className="match">
      <span className="where">{m.where === "body" ? "In the text" : m.where === "tag" ? "Tag" : m.label}</span>{" "}
      <Marked o={m.origin}><Highlight text={m.text} terms={terms} /></Marked>
    </p>
  );
}

function Locked({ on }: { on: boolean }) {
  return on ? <span className="lock" title="Private: no AI reads this"><Icon name="lock" /> Private</span> : null;
}

const hashOf = (q: string, f: FilterState, sort: string) => {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (f.type) p.set("type", f.type);
  if (f.tag) p.set("tag", f.tag);
  if (f.date) p.set("date", f.date);
  if (f.unreviewed) p.set("unreviewed", "1");
  if (f.noConnections) p.set("nolinks", "1");
  if (sort) p.set("sort", sort);
  return "#/search" + (p.toString() ? "?" + p : "");
};
export const searchHash = (q: string) => hashOf(q, noFilters, "");

export function SearchPage({ hash, types, version, onOpen }: { hash: string; types: Types; version: number; onOpen: (id: string, ids: string[]) => void }) {
  const p = new URLSearchParams(hash.split("?")[1] ?? "");
  const [q, setQ] = useState(p.get("q") ?? "");
  const [filters, setFilters] = useState<FilterState>({ type: p.get("type") ?? "", tag: p.get("tag") ?? "", date: p.get("date") ?? "", unreviewed: p.has("unreviewed"), noConnections: p.has("nolinks") });
  const [sort, setSort] = useSort(`search:${filters.type || "all"}`, q ? "relevance" : "changed", true);
  const query = useFilterQuery(filters, sort);
  const [res, setRes] = useState<FindResult | null>(null);
  const [typed, setTyped] = useState(q);
  useEffect(() => { const t = setTimeout(() => setQ(typed), 180); return () => clearTimeout(t); }, [typed]);
  useEffect(() => {
    let stale = false;
    api.find({ ...query, q, limit: 100 }).then((r) => { if (!stale) setRes(r); });
    return () => { stale = true; };
  }, [q, query, version]);
  // The page keeps its settings in the address, so going back and forward (⌘[ ⌘]) brings them back without a new history step per keystroke.
  useEffect(() => { history.replaceState(null, "", hashOf(q, filters, sort)); }, [q, filters, sort]);
  const ids = res?.hits.map((h) => h.id) ?? [];
  return (
    <main className="contents wrap search-page">
      <header className="vol"><h2>Search{res ? <em> {res.total}</em> : null}</h2></header>
      <input className="bigsearch" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Search titles, text, Tags, facts and AI Notes…" aria-label="Search the Garden" />
      <FilterBar value={filters} onChange={setFilters} types={types} sort={sort} onSort={setSort} relevance={!!q} />
      {res?.corrected.length ? (
        <p className="quiet small">No exact match for {res.corrected.map((c) => `“${c.from}”`).join(", ")}. Showing results for {res.corrected.map((c) => `“${c.to.join("”, “")}”`).join(", ")}.</p>
      ) : null}
      {res && !res.hits.length && <p className="quiet">{q ? "Nothing found." : "Nothing matches these filters."} Private Objects are searched too.</p>}
      <ol className="results">
        {res?.hits.map((h) => {
          const label = types.types.find((t) => t.key === h.type)?.label ?? h.type;
          return (
            <li key={h.id} style={typeVar(h.type)} tabIndex={0} role="button" onClick={() => onOpen(h.id, ids)} onKeyDown={(e) => e.key === "Enter" && onOpen(h.id, ids)}>
              <span className="kk"><Icon name={h.type} /> {label}</span>
              <h4><Highlight text={h.title} terms={res.terms} /></h4>
              <MatchLine hit={h} terms={res.terms} />
              <div className="m">
                <span>{formatDay(h.updatedAt)}</span>
                {h.connectionCount > 0 && <span>{h.connectionCount} {h.connectionCount === 1 ? "Connection" : "Connections"}</span>}
                <Locked on={h.private} />
                {h.tags.map((t) => <TagPill key={t.id} tag={t} />)}
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}

/** ⌘K: top matches grouped by type, or the Objects opened lately when the box is empty. Enter alone opens the full Search page. */
export function Palette({ types, onClose, go }: { types: Types; onClose: () => void; go: (hash: string) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Hit[] | null>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [at, setAt] = useState(-1);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      const ask = q.trim() ? api.find({ q, limit: 30 }).then((r) => { setTerms(r.terms); return r.hits; }) : (setTerms([]), recentIds().length ? api.recent(recentIds()) : Promise.resolve([] as Hit[]));
      ask.then((r) => { if (!stale) { setRows(r); setAt(-1); } });
    }, q ? 90 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [q]);
  // Up to four per type while searching; the recent items stay in the order they were opened.
  const groups = q.trim()
    ? types.types.map((t) => ({ name: t.plural, rows: (rows ?? []).filter((r) => r.type === t.key).slice(0, 4) })).filter((g) => g.rows.length)
    : rows?.length ? [{ name: "Recent", rows }] : [];
  const flat = groups.flatMap((g) => g.rows);
  const open = (id: string) => { onClose(); go(`#/o/${id}`); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(a + 1, flat.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(a - 1, -1)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (at >= 0 && flat[at]) open(flat[at].id);
      else { onClose(); go(searchHash(q.trim())); }
    }
  };
  useEffect(() => { list.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" }); }, [at]);
  return (
    <div className="scrim cap-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Search" onKeyDown={onKey}>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything you can see…" aria-label="Search the Garden" />
        <div className="palette-list" ref={list}>
          {rows && !flat.length && <p className="quiet small pad-s">{q.trim() ? "Nothing found. Press Enter to open the full Search page." : "Nothing opened yet. Type to search."}</p>}
          {groups.map((g) => (
            <section key={g.name}>
              <h5>{g.name}</h5>
              {g.rows.map((h) => {
                const i = flat.indexOf(h);
                return (
                  <button key={h.id} className={`prow ${i === at ? "on" : ""}`} style={typeVar(h.type)} onMouseEnter={() => setAt(i)} onClick={() => open(h.id)}>
                    <Icon name={h.type} />
                    <span className="ptitle"><Highlight text={h.title} terms={terms} /></span>
                    <Locked on={h.private} />
                    {q.trim() && h.match && h.match.where !== "title" && !h.title.includes(h.match.text.replace(/^…|…$/g, "")) && <span className="psub"><Marked o={h.match.origin}><Highlight text={h.match.text} terms={terms} /></Marked></span>}
                  </button>
                );
              })}
            </section>
          ))}
        </div>
        <footer className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>↵</kbd> {at >= 0 ? "open" : "see all results"}</span><span><kbd>esc</kbd> close</span></footer>
      </div>
    </div>
  );
}
