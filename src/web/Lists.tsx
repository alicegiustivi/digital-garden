import { CardStatus } from "./Ai";
import { GardenStrip } from "./Garden";
import { useEffect, useState } from "react";
import { BackupNote } from "./Backup";
import { api, inboxApi, displayTitle, TAG_COLORS, type Filters, type Summary, type TagRow, type Types } from "./api";
import { FilterBar, noFilters, useFilterQuery, useSort, type FilterState } from "./Filters";
import { showToast } from "./toast";
import { Icon, TagPill, TypeChip, formatDay, subOf, typeVar, tagVar } from "./ui";

export function useList(q: Filters, version: number) {
  const [rows, setRows] = useState<Summary[] | null>(null);
  const key = JSON.stringify(q);
  useEffect(() => { api.list(q).then(setRows); }, [key, version]);
  return rows;
}

export function Card({ o, types, onOpen }: { o: Summary; types: Types; onOpen: () => void }) {
  const label = types.types.find((t) => t.key === o.type)!.label;
  return (
    <article className="story" style={typeVar(o.type)} tabIndex={0} role="button" onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()}>
      <span className="kk"><Icon name={o.type} /> {label}{subOf(o) ? ` · ${subOf(o)}` : ""}</span>
      <h4>{displayTitle(o)}</h4>
      <div className="m">
        <span>{formatDay(o.updatedAt)}</span>
        {o.connectionCount > 0 && <span>{o.connectionCount} {o.connectionCount === 1 ? "Connection" : "Connections"}</span>}
        {o.private && <span title="Private: no AI reads this"><Icon name="lock" /> Private</span>}
      </div>
      {o.tags.length > 0 && <div className="tags">{o.tags.map((t) => <TagPill key={t.id} tag={t} />)}</div>}
    </article>
  );
}

function NewButtons({ types, onNew, only }: { types: Types; onNew: (type: string) => void; only?: string }) {
  return (
    <div className="new-row">
      {types.types.filter((t) => !only || t.key === only).map((t) => (
        <button key={t.key} className="pill action" style={typeVar(t.key)} onClick={() => onNew(t.key)}>
          <Icon name="plus" /> New {t.label}
        </button>
      ))}
    </div>
  );
}

export function TypeList({ typeKey, types, version, onNew, onOpen }: {
  typeKey: string; types: Types; version: number; onNew: (t: string) => void; onOpen: (id: string, ids: string[]) => void;
}) {
  const def = types.types.find((t) => t.key === typeKey)!;
  const [filters, setFilters] = useState<FilterState>({ ...noFilters, type: typeKey });
  useEffect(() => setFilters({ ...noFilters, type: typeKey }), [typeKey]);
  const [sort, setSort] = useSort(typeKey, "changed", false);
  const query = useFilterQuery({ ...filters, type: typeKey }, sort);
  const rows = useList(query, version);
  const filtered = filters.tag || filters.date || filters.unreviewed || filters.noConnections;
  return (
    <main className="contents wrap">
      <header className="vol">
        <h2>{def.plural}{rows ? <em> {rows.length}</em> : null}</h2>
        <NewButtons types={types} only={typeKey} onNew={onNew} />
      </header>
      <FilterBar value={filters} onChange={setFilters} types={types} sort={sort} onSort={setSort} lock={["type"]} />
      <Grid rows={rows} types={types} onOpen={onOpen} empty={filtered ? "Nothing matches these filters." : `No ${def.plural.toLowerCase()} yet. Make the first one with the button above.`} />
    </main>
  );
}

export function Grid({ rows, types, onOpen, empty }: { rows: Summary[] | null; types: Types; onOpen: (id: string, ids: string[]) => void; empty: string }) {
  if (!rows) return <p className="quiet">Opening…</p>;
  if (!rows.length) return <p className="quiet">{empty}</p>;
  const ids = rows.map((r) => r.id);
  return <div className="stories">{rows.map((o) => <Card key={o.id} o={o} types={types} onOpen={() => onOpen(o.id, ids)} />)}</div>;
}

export function ThisWeek({ types, version, unreviewed, onNew, onOpen }: { types: Types; version: number; unreviewed: number; onNew: (t: string) => void; onOpen: (id: string, ids: string[]) => void }) {
  const [since] = useState(() => new Date(Date.now() - 7 * 864e5).toISOString());
  const rows = useList({ since }, version);
  const lead = rows?.find((r) => r.type === "source");
  const rest = rows?.filter((r) => r !== lead) ?? [];
  const ids = [...(lead ? [lead.id] : []), ...rest.map((r) => r.id)]; // the order they appear on the page
  return (
    <main className="contents wrap">
      <header className="vol">
        <h2>This week <em>in your Garden</em></h2>
        <NewButtons types={types} onNew={onNew} />
      </header>
      <BackupNote />
      <div className="banners">
        {unreviewed > 0 && <a className="banner" href="#/unreviewed">{unreviewed} Unreviewed <span aria-hidden="true">→</span></a>}
        <a className="banner" href="#/timeline">Timeline, day by day <span aria-hidden="true">→</span></a>
      </div>
      <div className="weekgrid">
      <div className="week-main">
      {rows && lead && (
        <article className="lead" style={typeVar("source")} tabIndex={0} role="button" onClick={() => onOpen(lead.id, ids)} onKeyDown={(e) => e.key === "Enter" && onOpen(lead.id, ids)}>
          <div className="washbox">
            <span className="big"><Icon name="source" /></span>
            <div className="tags">{lead.tags.map((t) => <TagPill key={t.id} tag={t} />)}</div>
          </div>
          <div className="story-lead">
            <span className="kk"><Icon name="source" /> Newest Source{subOf(lead) ? ` · ${subOf(lead)}` : ""}</span>
            <h3>{displayTitle(lead)}</h3>
            <p>{lead.fields.find((f) => f.key === "captured")?.value ?? lead.firstLine}</p>
            <div className="m"><span>{formatDay(lead.updatedAt)}</span></div>
          </div>
        </article>
      )}
      <Grid rows={rows ? rest : null} types={types} onOpen={onOpen} empty={lead ? "" : "Nothing new this week yet. Make something with the buttons above."} />
      </div>
      <GardenStrip onOpen={onOpen} version={version} />
      </div>
    </main>
  );
}

export function TagsPage({ tag, types, version, onOpen, go, onChanged }: { onChanged?: () => void; tag?: string; types: Types; version: number; onOpen: (id: string, ids: string[]) => void; go: (hash: string) => void }) {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  useEffect(() => { api.tags().then(setTags); }, [version]);
  const [filters, setFilters] = useState<FilterState>(noFilters);
  useEffect(() => setFilters(noFilters), [tag]);
  const [sort, setSort] = useSort("tag", "changed", false);
  const query = useFilterQuery({ ...filters, tag: tag ?? "\u0000none" }, sort);
  const rows = useList(query, version);
  const current = tags?.find((t) => t.name === tag);
  const [mode, setMode] = useState<"remove" | "rename" | "merge" | "concept" | null>(null);
  const [keepTag, setKeepTag] = useState(false);
  const [name, setName] = useState("");
  const [into, setInto] = useState("");
  const [problem, setProblem] = useState("");
  useEffect(() => { setMode(null); setProblem(""); }, [tag]);
  const reload = () => { api.tags().then(setTags); onChanged?.(); };
  // Remove is asked first, then done at once with a few seconds of Undo.
  const doRemove = async () => {
    if (!current) return;
    const gone = await api.deleteTag(current.id);
    setMode(null);
    go("#/tags");
    reload();
    showToast(`Tag #${gone.tag.name} deleted. It was on ${gone.objects} ${gone.objects === 1 ? "Object" : "Objects"}.`, async () => { await api.restoreTag(gone); reload(); });
  };
  const doConcept = async () => {
    if (!current) return;
    try {
      const r = await api.turnIntoConcept(current.id, !keepTag);
      setMode(null);
      go(`#/o/${r.concept.id}`);
      reload();
      showToast(`Made the Concept “${r.concept.title}” and connected ${r.connected} ${r.connected === 1 ? "Object" : "Objects"}${r.removed ? `; #${current.name} is removed` : ""}.`, async () => { await api.undoConcept(r); go("#/tags"); reload(); });
    } catch (e) { setProblem((e as Error).message); }
  };
  const doRename = async () => {
    if (!current) return;
    try {
      const r = await api.renameTag(current.id, name);
      const now = r.tags.find((t) => t.id === current.id)!;
      setMode(null);
      go(`#/tags/${encodeURIComponent(now.name)}`);
      reload();
      showToast(`Renamed #${current.name} to #${now.name}.`, async () => { await api.undoRename(current.id, r.was); go(`#/tags/${encodeURIComponent(current.name)}`); reload(); });
    } catch (e) { setProblem((e as Error).message); }
  };
  const doMerge = async () => {
    if (!current || !into) return;
    try {
      const r = await api.mergeTag(current.id, Number(into));
      const target = r.merged.into;
      setMode(null);
      go(`#/tags/${encodeURIComponent(target.name)}`);
      reload();
      showToast(`Merged #${current.name} into #${target.name}.`, async () => { await api.undoMerge(r.merged); go(`#/tags/${encodeURIComponent(current.name)}`); reload(); });
    } catch (e) { setProblem((e as Error).message); }
  };
  const filtered = filters.type || filters.date || filters.unreviewed || filters.noConnections;
  return (
    <main className="contents wrap">
      <header className="vol"><h2>Tags{tags ? <em> {tags.length}</em> : null}</h2></header>
      {tags && !tags.length && <p className="quiet">No Tags yet. Press t on any Object to add one.</p>}
      <div className="tag-cloud">
        {tags?.map((t) => (
          <button key={t.id} className={`tag lg ${t.name === tag ? "on" : ""}`} style={tagVar(t.color)} onClick={() => go(t.name === tag ? "#/tags" : `#/tags/${encodeURIComponent(t.name)}`)}>
            #{t.name} <span className="count">{t.count}</span>
          </button>
        ))}
      </div>
      {current && (
        <>
          <div className="swatches" aria-label={`Colour for #${current.name}`}>
            <span className="quiet small">Colour for #{current.name}</span>
            {TAG_COLORS.map((c) => (
              <button key={c} className={`swatch ${current.color === c ? "on" : ""}`} style={tagVar(c)} aria-label={c} onClick={() => api.recolour(current.id, c).then(setTags)} />
            ))}
          </div>
          <p className="tag-actions">
            <button className="pill action" onClick={() => { setMode("rename"); setName(current.name); setProblem(""); }}>Rename…</button>
            <button className="pill action" disabled={(tags?.length ?? 0) < 2} onClick={() => { setMode("merge"); setInto(""); setProblem(""); }}>Merge into another…</button>
            <button className="pill action" onClick={() => { setMode("concept"); setKeepTag(false); setProblem(""); }}>Turn into Concept…</button>
            <button className="pill action" onClick={() => setMode("remove")}>Delete Tag…</button>
          </p>
          {mode === "rename" && (
            <form className="confirm" onSubmit={(e) => { e.preventDefault(); doRename(); }}>
              New name for #{current.name}: <input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="New name" />{" "}
              <button className="pill action" type="submit">Rename</button>{" "}
              <button className="pill toggle" type="button" onClick={() => setMode(null)}>Cancel</button>
              <span className="quiet small"> Because you typed it, the new name counts as yours everywhere.</span>
              {problem && <span role="alert" className="problem"> {problem}</span>}
            </form>
          )}
          {mode === "merge" && (
            <p className="confirm" role="group" aria-label="Merge">
              Move everything tagged #{current.name} onto{" "}
              <select autoFocus value={into} onChange={(e) => setInto(e.target.value)} aria-label="Merge into">
                <option value="">Choose a Tag…</option>
                {tags?.filter((t) => t.id !== current.id).map((t) => <option key={t.id} value={t.id}>#{t.name} ({t.count})</option>)}
              </select>{" "}
              and drop #{current.name}.{" "}
              <button className="pill action" disabled={!into} onClick={doMerge}>Merge</button>{" "}
              <button className="pill toggle" onClick={() => setMode(null)}>Cancel</button>
              {problem && <span role="alert" className="problem"> {problem}</span>}
            </p>
          )}
          {mode === "concept" && (
            <p className="confirm" role="group" aria-label="Turn into Concept">
              Make a Concept called “{current.name}” and connect the {current.count} {current.count === 1 ? "Object" : "Objects"} tagged #{current.name} to it.{" "}
              <label><input type="checkbox" checked={!keepTag} onChange={(e) => setKeepTag(!e.target.checked)} /> Remove the Tag afterwards</label>{" "}
              <button className="pill action" onClick={doConcept}>Turn into Concept</button>{" "}
              <button className="pill toggle" onClick={() => setMode(null)}>Cancel</button>
              <span className="quiet small"> The Concept and its Connections count as yours. You can undo this right after.</span>
              {problem && <span role="alert" className="problem"> {problem}</span>}
            </p>
          )}
          {mode === "remove" && (
            <p className="confirm" role="alertdialog">
              Delete #{current.name} permanently? It is on {current.count} {current.count === 1 ? "Object" : "Objects"}; the {current.count === 1 ? "Object stays" : "Objects stay"}, only the Tag goes.{" "}
              <button className="pill action danger" onClick={doRemove}>Delete</button>{" "}
              <button className="pill toggle" onClick={() => setMode(null)}>Keep it</button>
            </p>
          )}
          <FilterBar value={filters} onChange={setFilters} types={types} sort={sort} onSort={setSort} lock={["tag"]} />
          <Grid rows={rows} types={types} onOpen={onOpen} empty={filtered ? "Nothing matches these filters." : "Nothing carries this Tag any more."} />
        </>
      )}
    </main>
  );
}

export { TypeChip };

const DAY = 864e5;
/** Today / This week / Earlier, by when each was captured. */
function groupByAge(rows: Summary[]) {
  const startToday = new Date().setHours(0, 0, 0, 0);
  const groups: { name: string; rows: Summary[] }[] = [{ name: "Today", rows: [] }, { name: "This week", rows: [] }, { name: "Earlier", rows: [] }];
  for (const r of rows) {
    const t = new Date(r.createdAt).getTime();
    groups[t >= startToday ? 0 : t >= startToday - 6 * DAY ? 1 : 2].rows.push(r);
  }
  return groups.filter((g) => g.rows.length);
}


export function UnreviewedPage({ rows, types, onOpen, onReviewed }: {
  rows: Summary[] | null; types: Types; onOpen: (id: string, ids: string[]) => void; onReviewed: (ids: string[]) => void;
}) {
  const ids = rows?.map((r) => r.id) ?? []; // the order they appear on the page, top group first
  // Which of these came from the phone: their cards link to that day's Daily Inbox.
  const [fromPhone, setFromPhone] = useState<Record<string, string>>({});
  const key = ids.join(",");
  useEffect(() => { if (ids.length) inboxApi.inboxOf(ids).then(setFromPhone).catch(() => {}); else setFromPhone({}); }, [key]);
  return (
    <main className="contents wrap">
      <header className="vol"><h2>Unreviewed{rows ? <em> {rows.length}</em> : null}</h2></header>
      {rows && !rows.length && <p className="quiet">Nothing waiting. Everything you capture shows up here until you tick it Reviewed.</p>}
      {rows && rows.length > 0 && <p className="quiet small">Open one to step through them with the arrow keys. Press R to tick Reviewed and move on. Reviewed only means “I’ve looked at this”.</p>}
      {rows && groupByAge(rows).map((g) => (
        <section key={g.name} className="ugroup">
          <div className="ugroup-h">
            <h3>{g.name} <span className="quiet">{g.rows.length}</span></h3>
            <button className="pill action" onClick={() => onReviewed(g.rows.map((r) => r.id))}>Mark all reviewed</button>
          </div>
          <div className="stories">
            {g.rows.map((o) => (
              <div key={o.id} className="ucard">
                <Card o={o} types={types} onOpen={() => onOpen(o.id, ids)} />
                <div className="ustatus quiet small"><CardStatus id={o.id} private={o.private} />{fromPhone[o.id] && <> · <a href={`#/inbox/${fromPhone[o.id]}`}>From your phone · Daily Inbox →</a></>}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
