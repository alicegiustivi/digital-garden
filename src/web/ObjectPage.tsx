import { InboxCommentLine } from "./Inbox";
import { useEffect, useRef, useState } from "react";
import { api, fieldOf, type PortraitBack, type FieldDef, type Obj, type TagRow, type Types } from "./api";
import { BodyEditor } from "./BodyEditor";
import { Editable } from "./Editable";
import { PictureProp, Stars } from "./PropKinds";
import { AiStatusLine } from "./Ai";
import { AiNotes, ArchivistSuggestions, WebLookup } from "./Suggestions";
import { ConnectionsPanel, MergeDialog } from "./Connections";
import { PieceProject, ProjectPieces } from "./PartOf";
import { AskPanel } from "./Inquiries";
import { ConceptDesk, DeskSummary, OpenQuestionControl, useDesk } from "./Desk";
import { wasMadeHere } from "./fresh";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { Icon, Marked, Portrait, TagPill, TypeChip, formatDay, subOf, typeVar } from "./ui";

type Props = { id: string; types: Types; fresh?: boolean; onChanged: () => void; beside: (id: string) => void; onDeleted?: () => void };

// The "⋯" menu at the top right of the cover: things you do TO this Object (not its properties).
function ActionsMenu({ isPrivate, onMerge, onBeside, onPrivate, onDelete }: { isPrivate: boolean; onMerge: () => void; onBeside: () => void; onPrivate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLButtonElement>("[role^=menuitem]")?.focus();
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const onKey = (e: React.KeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("[role^=menuitem]") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown" && items.length) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp" && items.length) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === "Tab" && open) setOpen(false);
  };
  const pick = (fn: () => void) => () => { setOpen(false); btn.current?.focus(); fn(); };
  return (
    <div className="more actions-more" ref={box} onKeyDown={onKey}>
      <button ref={btn} className="dots" aria-haspopup="menu" aria-expanded={open} aria-label="Actions for this Object" title="Actions" onClick={() => setOpen(!open)}><Icon name="dots" /></button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={pick(onMerge)} title="Merge a duplicate of this into one Object"><span className="tick" />Merge…</button>
          <button role="menuitem" onClick={pick(onBeside)} title="Open a second pane beside this one (⌥-click any Object to put it there)"><span className="tick" />Open beside</button>
          <button role="menuitemcheckbox" aria-checked={isPrivate} onClick={pick(onPrivate)} title="Private: no AI reads this."><span className="tick">{isPrivate ? <Icon name="check" /> : null}</span>{isPrivate ? "Private" : "Make Private"}</button>
          <hr className="menu-sep" />
          <button role="menuitem" onClick={pick(onDelete)} title="Move to the Bin. You can undo, and restore it for 30 days."><span className="tick" />Delete</button>
        </div>
      )}
    </div>
  );
}

export function ObjectPage({ id, types, fresh, onChanged, beside, onDeleted }: Props) {
  const tick = useRefresh();
  const [merging, setMerging] = useState(false);
  const [tab, setTab] = useState<"page" | "ask">("page");
  const [obj, setObj] = useState<Obj | null>(null);
  const [error, setError] = useState<string>();
  const [allTags, setAllTags] = useState<TagRow[]>([]);
  const desk = useDesk(obj?.type === "concept" ? id : null);

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
  // A Source's captured text can be a whole article: it goes in its own section below, so the coloured box stays slim
  // and the properties and Tags are always within reach. (A Concept's definition or a Person's description stay under the title.)
  const transcript = lead?.key === "captured" ? lead : undefined;
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

  const editor = (
    <BodyEditor
            selfId={obj.id}
            types={types}
            info={obj.mentions ?? {}}
            open={(mid, alt) => (alt ? beside(mid) : (location.hash = `#/o/${mid}`))}
            autofocus={(!!fresh || wasMadeHere(obj.id)) && obj.type === "thought"}
            paragraphs={ownerBlocks.map((b) => b.text)}
            placeholder={obj.type === "thought" ? "Write the thought…" : obj.type === "concept" ? "Where do you stand on this, for now?" : "Write in your own words…"}
            onSave={(p) => api.setBody(obj.id, p).then((o) => { setObj((cur) => (cur ? { ...cur, mentions: o.mentions, connectionCount: o.connectionCount } : cur)); onChanged(); refresh(); })}
    />
  );

  return (
    <article className="object" style={typeVar(obj.type)}>
      <section className="cover">
        {obj.hasImage && <img className="cover-pic" src={`/api/images/${obj.id}/full`} alt={title?.value ?? "Captured image"} />}
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
            {obj.private && <span className="kicker-lock" title="Private: no AI reads this."><Icon name="lock" /><span className="sr">Private</span></span>}
            <ActionsMenu
              isPrivate={obj.private}
              onMerge={() => setMerging(true)}
              onBeside={() => beside(obj.id)}
              onPrivate={() => api.patch(obj.id, { private: !obj.private }).then(update)}
              onDelete={remove}
            />
          </div>

          {obj.type === "person" && <PortraitControl obj={obj} name={title?.value || "this Person"} onChanged={update} />}

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

          {lead && !transcript && (
            <p className="standfirst">
              <Editable multiline value={fieldOf(obj, lead.key)?.value ?? ""} origin={fieldOf(obj, lead.key)} placeholder={`Add ${lead.label.toLowerCase()}`} onSave={(v) => saveFields({ [lead.key]: v })} />
            </p>
          )}

          <Properties
            defs={pills}
            obj={obj}
            onSave={(key, v) => saveFields({ [key]: v })}
            onObj={update}
            tags={<div className="tags">
              {obj.tags.map((t) => <TagPill key={t.id} tag={t} linked onRemove={() => removeTagHere(t)} />)}
              <TagInput known={allTags} onAdd={addTag} />
            </div>}
          />

          {obj.type === "piece" && <PieceProject id={obj.id} types={types} beside={beside} />}
          {obj.type === "thought" && <div className="byline"><OpenQuestionControl id={obj.id} beside={beside} /></div>}
          {obj.type === "concept" && <DeskSummary desk={desk} types={types} />}

          <ArchivistSuggestions obj={obj} types={types} onChanged={update} />
          <WebLookup obj={obj} onChanged={update} />
          <AiStatusLine id={obj.id} onChanged={update} />
          {obj.type === "source" && <InboxCommentLine id={obj.id} />}
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

      {obj.type === "concept" ? (
        <>
          <ConceptDesk desk={desk} types={types} beside={beside} id={obj.id} isPrivate={obj.private} view={<>{quotes.map((b) => <blockquote key={b.id} className="b-src"><Marked o={b}>{b.text}</Marked></blockquote>)}{editor}</>} />
          <div className="art">
            <div className="body">
              <AiNotes obj={obj} />
              <details className="manage-conns">
                <summary>Add or change Connections</summary>
                <ConnectionsPanel obj={obj} types={types} beside={beside} />
              </details>
            </div>
          </div>
        </>
      ) : (
      <div className="art">
        <div className="body">
          <div className="obj-tabs" role="tablist" aria-label="This Object">
            <button role="tab" aria-selected={tab === "page"} className={tab === "page" ? "on" : ""} onClick={() => setTab("page")}>Page</button>
            <button role="tab" aria-selected={tab === "ask"} className={tab === "ask" ? "on" : ""} onClick={() => setTab("ask")}>Ask</button>
          </div>
          {tab === "ask" ? <AskPanel objectId={obj.id} type={obj.type} isPrivate={obj.private} /> : <>
          {quotes.map((b) => (
            <blockquote key={b.id} className="b-src"><Marked o={b}>{b.text}</Marked></blockquote>
          ))}
          {editor}
          {obj.type === "project" && <ProjectPieces id={obj.id} types={types} beside={beside} />}
          <AiNotes obj={obj} />
          <ConnectionsPanel obj={obj} types={types} beside={beside} />
          {transcript && (
            <details className="transcript">
              <summary>
                {transcript.label}
                <span className="quiet small"> · {(fieldOf(obj, transcript.key)?.value.length ?? 0).toLocaleString()} characters</span>
              </summary>
              <Editable multiline value={fieldOf(obj, transcript.key)?.value ?? ""} origin={fieldOf(obj, transcript.key)} placeholder={`Add ${transcript.label.toLowerCase()}`} onSave={(v) => saveFields({ [transcript.key]: v })} />
            </details>
          )}
          </>}
        </div>
      </div>
      )}
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

/** An Object's properties as quiet rows: only the ones with a value, plus Tags, and one "Add property" for the rest (no empty dashed chips). */
function Properties({ defs, obj, onSave, onObj, tags }: { defs: FieldDef[]; obj: Obj; onSave: (key: string, v: string) => void; onObj: (o: Obj) => void; tags: React.ReactNode }) {
  const [added, setAdded] = useState<string[]>([]); // chosen from "Add property", kept on screen while still empty
  const [menu, setMenu] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setAdded([]), [obj.id]);
  useEffect(() => {
    if (!menu) return;
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [menu]);
  const has = (d: FieldDef) => (d.input === "image" ? !!obj.images?.[d.key] : !!fieldOf(obj, d.key));
  const shown = defs.filter((d) => has(d) || added.includes(d.key));
  const rest = defs.filter((d) => !shown.includes(d));
  return (
    <dl className="props">
      {shown.map((d) => {
        const f = fieldOf(obj, d.key);
        return (
          <div className="prop" key={d.key}>
            <dt>{d.label}</dt>
            <dd>
              {d.input === "rating" ? <Stars value={Number(f?.value) || 0} label={d.label} onSave={(v) => onSave(d.key, v)} />
              : d.input === "image" ? <PictureProp obj={obj} field={d.key} label={d.label} onChanged={onObj} />
              : <Editable
                value={f?.value ?? ""}
                origin={f}
                options={d.input === "select" ? d.options : null}
                startEditing={!f && added[added.length - 1] === d.key}
                placeholder={`Add ${d.label.toLowerCase()}`}
                onSave={(v) => onSave(d.key, v)}
              />}
            </dd>
          </div>
        );
      })}
      <div className="prop prop-tags"><dt>Tags</dt><dd>{tags}</dd></div>
      {rest.length > 0 && (
        <div className="prop-add more" ref={box}>
          <button className="add-prop" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}><Icon name="plus" /> Add property</button>
          {menu && (
            <div className="menu" role="menu">
              {rest.map((d) => <button key={d.key} role="menuitem" onClick={() => { setAdded((a) => [...a, d.key]); setMenu(false); }}>{d.label}</button>)}
            </div>
          )}
        </div>
      )}
    </dl>
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
        placeholder="Add tag"
        title="Press t anywhere on this page to jump here"
        aria-label="Add a Tag"
        size={Math.max(text.length, 8)}
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

/** A Person's Portrait (issue #69): click to choose a photo, drop one on it, or click it and paste. Replace or remove, with Undo. */
function PortraitControl({ obj, name, onChanged }: { obj: Obj; name: string; onChanged: (o: Obj) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const had = !!obj.portrait;
  const apply = (o: Obj & { previous: PortraitBack }) => { const { previous: _p, ...rest } = o as any; onChanged(rest as Obj); refresh(); };
  const undoTo = (back: PortraitBack) => async () => apply(await api.restorePortrait(obj.id, back));
  const choose = async (files: File[]) => {
    const pic = files.find((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!pic) { showToast("That isn't a photo. Choose a picture file (HEIC works too)."); return; }
    setBusy(true);
    try {
      const r = await api.setPortrait(obj.id, pic);
      apply(r);
      showToast(had ? "Portrait replaced." : "Portrait added.", undoTo(r.previous));
    } catch (e) { showToast((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    const r = await api.removePortrait(obj.id);
    apply(r);
    showToast("Portrait removed.", undoTo(r.previous));
  };
  return (
    <div className={`portrait-box${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void choose([...e.dataTransfer.files]); }}>
      <button className="portrait-pick" type="button" disabled={busy} aria-label={had ? "Replace the Portrait" : "Add a Portrait"}
        title="Click to choose a photo. You can also drop one here, or click and then paste (⌘V)."
        onClick={() => input.current?.click()}
        onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); void choose(f); } }}>
        <Portrait stem={obj.portrait} size={112} name={name} full />
        {busy && <span className="portrait-busy">Shrinking…</span>}
      </button>
      <input ref={input} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void choose(f); }} />
      <span className="portrait-actions">
        {had ? (<><button type="button" className="linkish" onClick={() => input.current?.click()}>Replace</button><button type="button" className="linkish" onClick={remove}>Remove</button></>)
          : <button type="button" className="linkish" onClick={() => input.current?.click()}>Add a Portrait</button>}
        {!had && <span className="quiet small">or drop a photo here, or click the circle and paste</span>}
      </span>
    </div>
  );
}
