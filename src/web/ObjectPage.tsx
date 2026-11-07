import { useEffect, useState } from "react";
import { api, fieldOf, type FieldDef, type Obj, type TagRow, type TypeDef, type Types } from "./api";
import { BodyEditor } from "./BodyEditor";
import { Editable } from "./Editable";
import { AiStatusLine } from "./Ai";
import { ConnectionsPanel, MergeDialog } from "./Connections";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { Icon, Marked, TagPill, TypeChip, formatDay, subOf, typeVar } from "./ui";

type Props = { id: string; types: Types; fresh?: boolean; onChanged: () => void; beside: (id: string) => void; onDeleted?: () => void };

export function ObjectPage({ id, types, fresh, onChanged, beside, onDeleted }: Props) {
  const tick = useRefresh();
  const [merging, setMerging] = useState(false);
  const [obj, setObj] = useState<Obj | null>(null);
  const [error, setError] = useState<string>();
  const [allTags, setAllTags] = useState<TagRow[]>([]);

  useEffect(() => {
    api.get(id).then(setObj).catch((e) => setError(e.message));
    api.tags().then(setAllTags);
  }, [id, tick]);

  // One keystroke: press t (when you're not typing) to jump to the Tag box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el.closest("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      document.querySelector<HTMLInputElement>(".tag-input")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (error) return <p className="quiet pad">This one could not be opened: {error}</p>;
  if (!obj) return <p className="quiet pad">Opening…</p>;

  const typeDef = types.types.find((t) => t.key === obj.type)!;
  const update = (o: Obj) => { setObj(o); onChanged(); };
  const saveFields = (fields: Record<string, string | null>) => api.patch(obj.id, { fields }).then(update);

  const lead = typeDef.fields.find((f) => f.lead);
  const pills = typeDef.fields.filter((f) => !f.lead);
  const fitKeys = new Set(["title", ...typeDef.fields.map((f) => f.key)]);
  const kept = obj.fields.filter((f) => !fitKeys.has(f.key));
  const title = fieldOf(obj, "title");
  const sub = subOf(obj);
  const ownerBlocks = obj.blocks.filter((b) => b.origin === "owner");
  const quotes = obj.blocks.filter((b) => b.origin !== "owner");

  const addTag = async (name: string) => {
    const o = await api.addTag(obj.id, name);
    update(o);
    api.tags().then(setAllTags);
  };

  const remove = async () => {
    await api.deleteObject(obj.id);
    const name = fieldOf(obj, "title")?.value || obj.firstLine || "Untitled";
    onChanged();
    onDeleted?.();
    showToast(`“${name}” moved to the Bin.`, async () => { await api.restoreObject(obj.id); onChanged(); refresh(); location.hash = `#/o/${obj.id}`; });
  };
  const removeTagHere = async (t: Obj["tags"][number]) => {
    update(await api.removeTag(obj.id, t.id));
    showToast(`Tag #${t.name} removed from this one.`, async () => { update(await api.restoreTagOn(obj.id, t.id, t)); });
  };

  return (
    <article className="object" style={typeVar(obj.type)}>
      <section className="cover">
        <div className="in">
          <div className="kicker">
            <span className="big"><Icon name={obj.type} /></span>
            <label className="type-switch" title="Change the type. Values that don't fit are kept.">
              <TypeChip type={obj.type} label={typeDef.label} sub={sub} />
              <Icon name="chevron" />
              <select value={obj.type} aria-label="Object Type" onChange={(e) => api.patch(obj.id, { type: e.target.value }).then(update)}>
                {types.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
          </div>

          <h1 className="title">
            <Editable
              multiline
              startEditing={fresh && obj.type !== "thought"}
              value={title?.value ?? ""}
              origin={title}
              placeholder={obj.type === "thought" ? "Untitled (your first line shows)" : `Name this ${typeDef.label.toLowerCase()}`}
              onSave={(v) => saveFields({ title: v })}
            />
          </h1>

          {lead && (
            <p className="standfirst">
              <Editable multiline value={fieldOf(obj, lead.key)?.value ?? ""} origin={fieldOf(obj, lead.key)} placeholder={`Add ${lead.label.toLowerCase()}`} onSave={(v) => saveFields({ [lead.key]: v })} />
            </p>
          )}

          <div className="byline">
            {pills.map((f) => <FieldPill key={f.key} def={f} obj={obj} onSave={(v) => saveFields({ [f.key]: v })} />)}
            <button className="pill toggle" onClick={() => setMerging(true)} title="Merge a duplicate of this into one Object">Merge…</button>
            <button className="pill toggle" onClick={() => beside(obj.id)} title="Open a second pane beside this one (⌥-click any Object to put it there)">Beside</button>
            <button className="pill toggle" onClick={remove} title="Move to the Bin. You can undo, and restore it for 30 days.">Delete</button>
            <button className={`pill toggle ${obj.private ? "on" : ""}`} aria-pressed={obj.private} onClick={() => api.patch(obj.id, { private: !obj.private }).then(update)}>
              <Icon name="lock" /> Private
            </button>
          </div>

          <div className="tags">
            {obj.tags.map((t) => <TagPill key={t.id} tag={t} onRemove={() => removeTagHere(t)} />)}
            <TagInput known={allTags} onAdd={addTag} />
          </div>

          {obj.private && <p className="quiet small">Private: no AI reads this.</p>}
          <AiStatusLine id={obj.id} onChanged={update} />
          {kept.length > 0 && (
            <p className="quiet small kept">
              Kept from an earlier type:{" "}
              {kept.map((f, i) => (
                <span key={f.key}>{i > 0 && " · "}{types.fieldLabels[f.key]?.label ?? f.key}: <Marked o={f}>{f.value}</Marked></span>
              ))}
            </p>
          )}
          <p className="quiet small dates">Made {formatDay(obj.createdAt)} · changed {formatDay(obj.updatedAt)}</p>
        </div>
      </section>

      <div className="art">
        <div className="body">
          {obj.hasImage && <figure className="cover-img"><img src={`/api/images/${obj.id}/full`} alt={title?.value ?? "Captured image"} /></figure>}
          {quotes.map((b) => (
            <blockquote key={b.id} className="b-src"><Marked o={b}>{b.text}</Marked></blockquote>
          ))}
          <BodyEditor
            selfId={obj.id}
            types={types}
            info={obj.mentions ?? {}}
            open={(mid, alt) => (alt ? beside(mid) : (location.hash = `#/o/${mid}`))}
            autofocus={!!fresh && obj.type === "thought"}
            paragraphs={ownerBlocks.map((b) => b.text)}
            placeholder={obj.type === "thought" ? "Write the thought…" : "Write in your own words…"}
            onSave={(p) => api.setBody(obj.id, p).then((o) => { setObj((cur) => (cur ? { ...cur, mentions: o.mentions, connectionCount: o.connectionCount } : cur)); onChanged(); refresh(); })}
          />
          <ConnectionsPanel obj={obj} types={types} beside={beside} />
        </div>
      </div>
      {merging && (
        <MergeDialog
          obj={obj}
          types={types}
          onClose={() => setMerging(false)}
          onDone={(keepId) => { setMerging(false); onChanged(); if (keepId !== obj.id) location.hash = `#/o/${keepId}`; }}
        />
      )}
    </article>
  );
}

function FieldPill({ def, obj, onSave }: { def: FieldDef; obj: Obj; onSave: (v: string) => void }) {
  const f = fieldOf(obj, def.key);
  return (
    <span className={`pill ${f ? "" : "ghost"}`}>
      {f ? <span className="k">{def.label}</span> : null}
      <Editable
        value={f?.value ?? ""}
        origin={f}
        options={def.input === "select" ? def.options : null}
        placeholder={`+ ${def.label}`}
        onSave={onSave}
      />
    </span>
  );
}

function TagInput({ known, onAdd }: { known: TagRow[]; onAdd: (name: string) => void }) {
  const [text, setText] = useState("");
  return (
    <>
      <input
        className="tag-input"
        value={text}
        list="known-tags"
        placeholder="+ tag  (press t)"
        aria-label="Add a Tag"
        size={Math.max(text.length, 14)}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === ",") && text.trim()) { e.preventDefault(); onAdd(text); setText(""); }
          if (e.key === "Escape") { e.stopPropagation(); (e.target as HTMLElement).blur(); setText(""); }
        }}
      />
      <datalist id="known-tags">{known.map((t) => <option key={t.id} value={t.name} />)}</datalist>
    </>
  );
}
