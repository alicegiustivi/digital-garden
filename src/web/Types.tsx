// The Types page (issue #107, ADR 0008): every Object Type in one list, the four core ones with the types the owner made.
// The owner can recolour any type with one click, and make, rename, reorder, give properties to and remove their own.
import { useState } from "react";
import { api, type FieldDef, type TypeDef, type Types, type TypesAnswer } from "./api";
import { PALETTE, TYPE_ICONS } from "../shared/palette";
import { Icon, typeVar } from "./ui";
import { showToast } from "./toast";

type Props = { types: Types; onTypes: (t: Types) => void; go: (hash: string) => void };

const KIND: Record<string, string> = { text: "Short text", longtext: "Long text", select: "Choice" };
const listHash = (t: TypeDef) => (t.core ? `#/${t.plural.toLowerCase()}` : `#/t/${t.key}`);

/** The twelve colours. The chosen one carries a tick, so colour is never the only signal. */
export function Swatches({ value, onPick, label }: { value: string; onPick: (key: string) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {PALETTE.map((c) => (
        <button key={c.key} type="button" role="radio" aria-checked={value === c.key} className={value === c.key ? "on" : ""} title={c.label} aria-label={c.label}
          style={{ ["--sw-l" as string]: c.light, ["--sw-d" as string]: c.dark }} onClick={() => onPick(c.key)}>
          {value === c.key && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

function IconPicker({ value, onPick }: { value: string; onPick: (key: string) => void }) {
  return (
    <div className="icon-pick" role="radiogroup" aria-label="Icon">
      {TYPE_ICONS.map((i) => (
        <button key={i.key} type="button" role="radio" aria-checked={value === i.key} className={value === i.key ? "on" : ""} title={i.label} aria-label={i.label} onClick={() => onPick(i.key)}>
          <Icon name={i.key} />
        </button>
      ))}
    </div>
  );
}

/** One property: rename it, change a choice's options, show it under the title, move it, remove it (after saying what is lost). */
function PropertyRow({ type, f, first, last, run }: { type: TypeDef; f: FieldDef; first: boolean; last: boolean; run: (job: () => Promise<TypesAnswer>) => Promise<void> }) {
  const [name, setName] = useState(f.label);
  const [options, setOptions] = useState((f.options ?? []).join(", "));
  const [ask, setAsk] = useState<{ values: number; inBin: number } | null>(null);
  const keys = type.fields.map((x) => x.key);
  const move = (by: number) => { const k = [...keys]; const i = k.indexOf(f.key); [k[i], k[i + by]] = [k[i + by], k[i]]; return run(() => api.orderTypeFields(type.key, k)); };
  return (
    <li className="prop">
      <div className="prop-main">
        <input aria-label="Property name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== f.label && run(() => api.updateTypeField(type.key, f.key, { label: name }))} />
        <span className="quiet small">{KIND[f.input]}</span>
        <label className="small"><input type="checkbox" checked={!!f.lead} onChange={(e) => run(() => api.updateTypeField(type.key, f.key, { lead: e.target.checked }))} /> Show under the title</label>
        <span className="grow" />
        <button type="button" aria-label={`Move ${f.label} up`} disabled={first} onClick={() => move(-1)}>↑</button>
        <button type="button" aria-label={`Move ${f.label} down`} disabled={last} onClick={() => move(1)}>↓</button>
        <button type="button" className="pill" onClick={async () => setAsk(await api.typeFieldRemoval(type.key, f.key))}>Remove</button>
      </div>
      {f.input === "select" && (
        <label className="prop-opts small">Choices, separated by commas
          <input value={options} onChange={(e) => setOptions(e.target.value)} onBlur={() => run(() => api.updateTypeField(type.key, f.key, { options: options.split(",").map((o) => o.trim()).filter(Boolean) }))} />
        </label>
      )}
      {ask && (
        <p className="prop-ask" role="alert">
          {ask.values === 0 ? "No Object has a value here yet." : `${ask.values} ${ask.values === 1 ? "Object has" : "Objects have"} a value in “${f.label}”${ask.inBin ? ` (${ask.inBin} in the Bin)` : ""}. Removing the property deletes ${ask.values === 1 ? "that value" : "those values"}. A Backup still has them.`}
          {" "}<button type="button" className="pill action" onClick={() => run(() => api.removeTypeField(type.key, f.key))}>Remove “{f.label}”</button>
          {" "}<button type="button" className="pill" onClick={() => setAsk(null)}>Keep it</button>
        </p>
      )}
    </li>
  );
}

function NewProperty({ type, run }: { type: TypeDef; run: (job: () => Promise<TypesAnswer>) => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [input, setInput] = useState("text");
  const [options, setOptions] = useState("");
  const submit = async () => {
    await run(() => api.addTypeField(type.key, { label, input, options: options.split(",").map((o) => o.trim()).filter(Boolean) }));
    setLabel(""); setOptions("");
  };
  return (
    <form className="prop-new" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <input aria-label="New property name" placeholder="New property, e.g. Author" value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      <select aria-label="Kind of property" value={input} onChange={(e) => setInput(e.target.value)}>
        <option value="text">Short text</option><option value="longtext">Long text</option><option value="select">Choice from a list</option>
      </select>
      {input === "select" && <input aria-label="Choices, separated by commas" placeholder="Choices, separated by commas" value={options} onChange={(e) => setOptions(e.target.value)} />}
      <button type="submit" className="pill action" disabled={!label.trim()}><Icon name="plus" /> Add property</button>
    </form>
  );
}

function TypeEditor({ t, types, run, go }: { t: TypeDef; types: Types; run: (job: () => Promise<TypesAnswer>) => Promise<void>; go: Props["go"] }) {
  const [label, setLabel] = useState(t.label);
  const [plural, setPlural] = useState(t.plural);
  const [to, setTo] = useState("");
  const others = types.types.filter((x) => x.key !== t.key);
  const all = t.count + t.inBin;
  return (
    <div className="type-edit">
      {t.core ? (
        <p className="quiet small">A core type keeps its name, icon and fields, and every special thing it does. You can change its colour in its row.</p>
      ) : (
        <>
          <div className="row-fields">
            <label>Name<input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} onBlur={() => label.trim() !== t.label && run(() => api.updateType(t.key, { label }))} /></label>
            <label>Plural<input value={plural} maxLength={40} onChange={(e) => setPlural(e.target.value)} onBlur={() => plural.trim() !== t.plural && run(() => api.updateType(t.key, { plural }))} /></label>
          </div>
          <h4 className="small-h">Icon</h4>
          <IconPicker value={t.icon} onPick={(icon) => run(() => api.updateType(t.key, { icon }))} />
          <h4 className="small-h">Properties</h4>
          <p className="quiet small">Every {t.label} also has a title, a body, Tags and Connections. These are the extra things it carries.</p>
          {t.fields.length > 0 && (
            <ul className="props">{t.fields.map((f, i) => <PropertyRow key={f.key} type={t} f={f} first={i === 0} last={i === t.fields.length - 1} run={run} />)}</ul>
          )}
          <NewProperty type={t} run={run} />
          <h4 className="small-h">Removing this type</h4>
          {all > 0 ? (
            <p className="small">{t.plural} has {all} {all === 1 ? "Object" : "Objects"}{t.inBin ? ` (${t.inBin} in the Bin)` : ""}. Move {all === 1 ? "it" : "them"} to another type first, then this type can be removed.
              <span className="move-row">
                <select aria-label="Move to" value={to} onChange={(e) => setTo(e.target.value)}><option value="">Move to…</option>{others.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
                <button type="button" className="pill action" disabled={!to} onClick={() => run(async () => { const r = await api.moveTypeObjects(t.key, to); showToast(`Moved ${r.moved} ${r.moved === 1 ? "Object" : "Objects"} to ${types.types.find((x) => x.key === to)?.label}.`); return r; })}>Move them</button>
              </span>
            </p>
          ) : (
            <p className="small">Nothing is in this type. <button type="button" className="pill" onClick={() => run(async () => { const r = await api.deleteType(t.key); showToast(`Removed the type ${t.label}.`); return r; })}>Remove {t.label}</button></p>
          )}
        </>
      )}
      {t.count > 0 && <p className="small"><a href={listHash(t)} onClick={() => go(listHash(t))}>See the {t.count} {t.count === 1 ? "Object" : "Objects"} →</a></p>}
    </div>
  );
}

function NewType({ run, onMade }: { run: (job: () => Promise<TypesAnswer>) => Promise<void>; onMade: (key: string) => void }) {
  const [label, setLabel] = useState("");
  const [plural, setPlural] = useState("");
  const [color, setColor] = useState("teal");
  const [icon, setIcon] = useState("book");
  const submit = () => run(async () => {
    const r = await api.createType({ label, plural: plural || undefined, color, icon });
    setLabel(""); setPlural(""); onMade(r.key!);
    return r;
  });
  return (
    <form className="type-new" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h3>Make a type of your own</h3>
      <div className="row-fields">
        <label>Name<input value={label} maxLength={40} placeholder="e.g. Book" onChange={(e) => setLabel(e.target.value)} /></label>
        <label>Plural (optional)<input value={plural} maxLength={40} placeholder="e.g. Books" onChange={(e) => setPlural(e.target.value)} /></label>
      </div>
      <h4 className="small-h">Colour</h4>
      <Swatches value={color} onPick={setColor} label="Colour of the new type" />
      <h4 className="small-h">Icon</h4>
      <IconPicker value={icon} onPick={setIcon} />
      <p><button type="submit" className="pill action" disabled={!label.trim()}><Icon name="plus" /> Make this type</button></p>
    </form>
  );
}

export function TypesPage({ types, onTypes, go }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (job: () => Promise<TypesAnswer>) => {
    try { setError(null); onTypes(await job()); } catch (e) { setError((e as Error).message); }
  };
  const editing = types.types.find((t) => t.key === open) ?? null;
  const keys = types.types.map((t) => t.key);
  const move = (key: string, by: number) => { const k = [...keys]; const i = k.indexOf(key); [k[i], k[i + by]] = [k[i + by], k[i]]; return run(() => api.orderTypes(k)); };
  return (
    <main className="wrap contents types-page">
      <header className="vol"><h2>Object Types</h2></header>
      <p className="quiet">Every Object has a type. Source, Concept, Thought and Person are the core types: you can change their colour. Make your own for anything else (a Book, a Place, a Recipe). A type of your own is a plain Object with the properties you choose. The Archivist never makes a type and never moves an Object into one.</p>
      {error && <p className="err" role="alert">{error}</p>}
      <div className="types-grid">
      <ul className="type-rows">
        {types.types.map((t, i) => (
          <li key={t.key} className={`type-row${open === t.key ? " open" : ""}`} style={typeVar(t.key)}>
            <div className="type-head">
              <span className="big"><Icon name={t.key} /></span>
              <div className="type-name">
                <strong>{t.label}</strong>{t.core && <span className="core-tag">Core</span>}
                <span className="quiet small"> {t.count} {t.count === 1 ? "Object" : "Objects"}{t.inBin ? ` · ${t.inBin} in the Bin` : ""}</span>
              </div>
              <span className="grow" />
              <button type="button" aria-label={`Move ${t.label} up`} disabled={i === 0} onClick={() => move(t.key, -1)}>↑</button>
              <button type="button" aria-label={`Move ${t.label} down`} disabled={i === types.types.length - 1} onClick={() => move(t.key, 1)}>↓</button>
              <button type="button" className="pill" aria-expanded={open === t.key} onClick={() => setOpen(open === t.key ? null : t.key)}>{open === t.key ? "Editing" : "Edit"}</button>
            </div>
            <Swatches value={t.color} label={`Colour of ${t.label}`} onPick={(color) => run(() => api.updateType(t.key, { color }))} />
          </li>
        ))}
      </ul>
      <aside className="types-panel" aria-label={editing ? `Edit ${editing.label}` : "Make a type"}>
        {editing ? (
          <section className="type-new" style={typeVar(editing.key)}>
            <h3>{editing.label}{editing.core && <span className="core-tag"> Core</span>}</h3>
            <TypeEditor key={editing.key} t={editing} types={types} run={run} go={go} />
            <p><button type="button" className="pill" onClick={() => setOpen(null)}>Done, make a new type instead</button></p>
          </section>
        ) : <NewType run={run} onMade={(k) => setOpen(k)} />}
      </aside>
      </div>
    </main>
  );
}
