import { useEffect, useState } from "react";
import { api, displayTitle, TAG_COLORS, type Summary, type TagRow, type Types } from "./api";
import { Icon, TagPill, TypeChip, formatDay, subOf, typeVar, tagVar } from "./ui";

export function useList(q: { type?: string; tag?: string; since?: string }, version: number) {
  const [rows, setRows] = useState<Summary[] | null>(null);
  const key = JSON.stringify(q);
  useEffect(() => { api.list(q).then(setRows); }, [key, version]);
  return rows;
}

function Card({ o, types, onOpen }: { o: Summary; types: Types; onOpen: () => void }) {
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
  const rows = useList({ type: typeKey }, version);
  return (
    <main className="contents wrap">
      <header className="vol">
        <h2>{def.plural}{rows ? <em> {rows.length}</em> : null}</h2>
        <NewButtons types={types} only={typeKey} onNew={onNew} />
      </header>
      <Grid rows={rows} types={types} onOpen={onOpen} empty={`No ${def.plural.toLowerCase()} yet. Make the first one with the button above.`} />
    </main>
  );
}

function Grid({ rows, types, onOpen, empty }: { rows: Summary[] | null; types: Types; onOpen: (id: string, ids: string[]) => void; empty: string }) {
  if (!rows) return <p className="quiet">Opening…</p>;
  if (!rows.length) return <p className="quiet">{empty}</p>;
  const ids = rows.map((r) => r.id);
  return <div className="stories">{rows.map((o) => <Card key={o.id} o={o} types={types} onOpen={() => onOpen(o.id, ids)} />)}</div>;
}

export function ThisWeek({ types, version, onNew, onOpen }: { types: Types; version: number; onNew: (t: string) => void; onOpen: (id: string, ids: string[]) => void }) {
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
    </main>
  );
}

export function TagsPage({ tag, types, version, onOpen, go }: { tag?: string; types: Types; version: number; onOpen: (id: string, ids: string[]) => void; go: (hash: string) => void }) {
  const [tags, setTags] = useState<TagRow[] | null>(null);
  useEffect(() => { api.tags().then(setTags); }, [version]);
  const rows = useList(tag ? { tag } : { tag: "\u0000none" }, version);
  const current = tags?.find((t) => t.name === tag);
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
          <Grid rows={rows} types={types} onOpen={onOpen} empty="Nothing carries this Tag any more." />
        </>
      )}
    </main>
  );
}

export { TypeChip };
