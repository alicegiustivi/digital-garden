// Connections (issue #7): each Object's Connections with the sentence that mentions it, Connect from a search,
// "Shares words with", the small labelled map, the second pane and Merge.
import { useEffect, useState } from "react";
import { api, type Connection, type Found, type KindChoice, type MergeAsk, type Obj, type Shares, type Types, displayTitle } from "./api";
import { Editable } from "./Editable";
import { ThoughtAbout } from "./Desk";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { Icon, Marked, TagPill, TypeChip, typeVar } from "./ui";

const go = (h: string) => { location.hash = h; };

/** Click opens the Object; ⌥-click opens it in the second pane. */
export const openLink = (id: string, beside: (id: string) => void) => (e: React.MouseEvent) => {
  e.preventDefault();
  if (e.altKey) beside(id);
  else go(`#/o/${id}`);
};

/** Find an Object by name (with an Object Type filter) and pick it. Works on Private Objects. */
export function FindObject({ types, exclude, onlyType, action, onPick, onClose, beside, autoFocus = true }: {
  types: Types; exclude: string; onlyType?: string; action: string; onPick: (f: Found) => void; onClose: () => void; beside?: (id: string) => void; autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState(onlyType ?? "");
  const [rows, setRows] = useState<Found[] | null>(null);
  const [at, setAt] = useState(0);
  useEffect(() => {
    let stale = false;
    api.search({ q, type, exclude, limit: 8 }).then((r) => { if (!stale) { setRows(r); setAt(0); } });
    return () => { stale = true; };
  }, [q, type, exclude]);
  const choose = (f?: Found) => { if (f && !f.connected) onPick(f); };
  return (
    <div className="finder" role="dialog" aria-label={action}>
      <div className="finder-top">
        <input
          autoFocus={autoFocus}
          value={q}
          placeholder="Search by name…"
          aria-label="Search Objects by name"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(i + 1, (rows?.length ?? 1) - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); choose(rows?.[at]); }
            if (e.key === "Escape") { e.stopPropagation(); onClose(); }
          }}
        />
        <button className="x" onClick={onClose} aria-label="Close search"><Icon name="close" /></button>
      </div>
      {!onlyType && (
        <div className="mp-chips">
          {["", ...types.types.map((t) => t.key)].map((k) => (
            <button key={k || "all"} className={type === k ? "on" : ""} style={k ? typeVar(k) : undefined} onClick={() => setType(k)}>
              {k ? <><Icon name={k} />{types.types.find((t) => t.key === k)!.label}</> : "All"}
            </button>
          ))}
        </div>
      )}
      <ul className="finder-rows">
        {rows?.map((f, i) => (
          <li key={f.id} className={i === at ? "on" : ""} style={typeVar(f.type)} onMouseEnter={() => setAt(i)}>
            <a href={`#/o/${f.id}`} onClick={beside ? openLink(f.id, beside) : undefined} title={beside ? "⌥-click opens it beside this one" : undefined}>
              <Icon name={f.type} /> <span className="mp-t">{f.title}</span> {f.private && <Icon name="lock" />}
              <span className="mp-k">{types.types.find((t) => t.key === f.type)?.label}</span>
            </a>
            {f.connected ? <span className="quiet small">Connected</span> : <button className="pill action" onClick={() => onPick(f)}>{action}</button>}
          </li>
        ))}
        {rows && !rows.length && <li className="quiet small none">Nothing is called that.</li>}
      </ul>
    </div>
  );
}

function KindSelect({ c, choices, onPick }: { c: Connection; choices: KindChoice[]; onPick: (k: KindChoice) => void }) {
  const current = `${c.kind}|${c.subject || c.kind === "related" || c.kind === "contradicts" ? 1 : 0}`;
  const usable = choices.filter((k) => k.kind !== "mentions" || c.kind === "mentions");
  return (
    <label className="kind" title="Change how these two are connected">
      <Marked o={c}><span>{c.label}</span></Marked>
      <Icon name="chevron" />
      <select
        aria-label={`How this is connected: ${c.label}`}
        value={current}
        onChange={(e) => { const [kind, s] = e.target.value.split("|"); onPick({ kind, subject: s === "1", label: "" }); }}
      >
        {usable.map((k) => <option key={`${k.kind}|${k.subject ? 1 : 0}`} value={`${k.kind}|${k.subject ? 1 : 0}`}>{k.label}</option>)}
      </select>
    </label>
  );
}

/** Under the body: each Object connected here, how, and the sentence that mentions it. */
export function ConnectionsPanel({ obj, types, beside }: { obj: Pick<Obj, "id">; types: Types; beside: (id: string) => void }) {
  const tick = useRefresh();
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [choices, setChoices] = useState<KindChoice[]>([]);
  const [finding, setFinding] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { api.connections(obj.id).then(setRows); }, [obj.id, tick]);
  useEffect(() => { api.kinds().then(setChoices); }, []);
  const run = (p: Promise<unknown>) => p.then(() => { setError(undefined); refresh(); }).catch((e) => setError(e.message));
  const removeConnection = (c: Connection) =>
    run(api.disconnect(c.id).then((r) => showToast(`Connection to ${c.other.title} removed.`, () => api.restoreConnection(r.was).then(refresh))));
  return (
    <section className="connections" aria-label="Connections">
      <header>
        <h3>Connections{rows ? <em> {rows.length}</em> : null}</h3>
        <button className="pill action" onClick={() => setFinding(!finding)} aria-expanded={finding}><Icon name="plus" /> Connect</button>
      </header>
      {finding && (
        <FindObject
          types={types}
          exclude={obj.id}
          action="Connect"
          beside={beside}
          onClose={() => setFinding(false)}
          onPick={(f) => run(api.connect(obj.id, f.id))}
        />
      )}
      {error && <p className="quiet small" role="alert">{error}</p>}
      {rows && !rows.length && <p className="quiet small">Nothing is connected yet. Mention an Object in your words with @, or press Connect.</p>}
      <ul className="conn-list">
        {rows?.map((c) => (
          <li key={c.id} className="conn" style={typeVar(c.other.type)}>
            <div className="conn-main">
              <KindSelect c={c} choices={choices} onPick={(k) => run(api.setConnection(c.id, { kind: k.kind, subject: k.subject ? obj.id : c.other.id }))} />
              <a className="conn-name" href={`#/o/${c.other.id}`} onClick={openLink(c.other.id, beside)} title="⌥-click opens it beside this one">
                <Icon name={c.other.type} /> {c.other.title} {c.other.private && <Icon name="lock" />}
              </a>
              <span className="quiet small">{c.other.connectionCount} {c.other.connectionCount === 1 ? "Connection" : "Connections"}</span>
              <span className="grow" />
              <button className="x" onClick={() => beside(c.other.id)} aria-label={`Open ${c.other.title} beside this one`} title="Open beside"><Icon name="expand" /></button>
              {c.origin === "ai" && !c.approved && c.aiRole === "Archivist" && (
                <button className="link-btn" onClick={() => run(api.undoAiConnection(c.id).then(() => showToast(`Taken back. The Archivist won’t connect ${c.other.title} again unless you ask.`)))} title="Take back this Connection the Archivist added">Undo</button>
              )}
              {!c.fromText && <button className="x" onClick={() => removeConnection(c)} aria-label={`Remove the Connection to ${c.other.title}`}><Icon name="close" /></button>}
            </div>
            {c.sentence && (
              <blockquote className="conn-sentence">
                {c.sentence}
                <cite>{c.sentenceBy === "other" ? `in ${c.other.title}` : "in your words here"}</cite>
              </blockquote>
            )}
            <div className="conn-note">
              <Editable value={c.note} placeholder="+ add a one-line note" onSave={(v) => run(api.setConnection(c.id, { note: v }))} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Objects that share unusual words or Tags with this one. Worked out on this Mac, never stored, no AI. */
export function SharesWords({ id, beside }: { id: string; beside: (id: string) => void }) {
  const tick = useRefresh();
  const [rows, setRows] = useState<Shares[] | null>(null);
  useEffect(() => { api.sharesWords(id).then(setRows); }, [id, tick]);
  return (
    <section className="shares" aria-label="Shares words with">
      <h3>Shares words with</h3>
      <p className="quiet small">Worked out on your Mac from your own words. Not a suggestion from the AI.</p>
      {rows && !rows.length && <p className="quiet small">Nothing else here shares enough words yet.</p>}
      <ul className="conn-list">
        {rows?.map((s) => (
          <li key={s.id} className="conn" style={typeVar(s.type)}>
            <div className="conn-main">
              <a className="conn-name" href={`#/o/${s.id}`} onClick={openLink(s.id, beside)}><Icon name={s.type} /> {s.title} {s.private && <Icon name="lock" />}</a>
              <span className="grow" />
              <button className="pill action" onClick={() => api.connect(id, s.id).then(refresh)}>Connect</button>
            </div>
            <p className="quiet small">{[...s.sharedTags.map((t) => `#${t}`), ...s.shared].join(" · ")}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A small, labelled map of one Object: it in the middle, what it is connected to around it. */
export function MapView({ id, types, onOpen }: { id: string; types: Types; onOpen: (id: string, beside: boolean) => void }) {
  const tick = useRefresh();
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [me, setMe] = useState<Obj | null>(null);
  useEffect(() => { api.connections(id).then(setRows); api.get(id).then(setMe); }, [id, tick]);
  if (!rows || !me) return <p className="quiet small">Drawing…</p>;
  const shown = rows.slice(0, 10);
  const W = 560, H = 380, cx = W / 2, cy = H / 2;
  const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  const typeOf = (t: string) => types.types.find((x) => x.key === t)?.label ?? t;
  return (
    <figure className="map">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Map of ${displayTitle(me)} and its ${rows.length} Connections`}>
        {shown.map((c, i) => {
          const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
          const x = cx + Math.cos(a) * 205, y = cy + Math.sin(a) * 135;
          const mx = (cx + x) / 2, my = (cy + y) / 2;
          return (
            <g key={c.id} style={typeVar(c.other.type)}>
              <line x1={cx} y1={cy} x2={x} y2={y} className="map-edge" />
              <text x={mx} y={my} className="map-label" textAnchor="middle"><tspan className="map-bg">{c.label}</tspan></text>
              <g className="map-node" transform={`translate(${x - 70} ${y - 19})`} tabIndex={0} role="link" aria-label={`${c.other.title}, ${typeOf(c.other.type)}. ⌥-click opens it beside.`}
                onClick={(e) => onOpen(c.other.id, e.altKey)} onKeyDown={(e) => e.key === "Enter" && onOpen(c.other.id, e.altKey)}>
                <rect width="140" height="38" rx="12" />
                <text x="70" y="16" textAnchor="middle" className="map-t">{short(c.other.title, 20)}</text>
                <text x="70" y="30" textAnchor="middle" className="map-k">{typeOf(c.other.type)}</text>
              </g>
            </g>
          );
        })}
        <g className="map-node me" style={typeVar(me.type)} transform={`translate(${cx - 80} ${cy - 22})`}>
          <rect width="160" height="44" rx="14" />
          <text x="80" y="19" textAnchor="middle" className="map-t">{short(displayTitle(me), 22)}</text>
          <text x="80" y="34" textAnchor="middle" className="map-k">{typeOf(me.type)}</text>
        </g>
      </svg>
      <figcaption className="quiet small">
        {rows.length === 0 ? "No Connections yet." : rows.length > shown.length ? `Showing ${shown.length} of ${rows.length} Connections.` : `${rows.length} ${rows.length === 1 ? "Connection" : "Connections"}.`} Click one to open it; ⌥-click puts it in this pane. <a href={`#/map/${id}`}>Draw it bigger</a>
      </figcaption>
    </figure>
  );
}

type Tab = "object" | "connections" | "map";

/** The second pane (⌥-open): another Object, its Connections or its map, beside the one you are reading. */
export function SidePane({ paneId, mainId, types, onNavigate, onClose, onChanged }: {
  paneId: string; mainId: string; types: Types; onNavigate: (id: string) => void; onClose: () => void; onChanged: () => void;
}) {
  const tick = useRefresh();
  const [tab, setTab] = useState<Tab>(paneId === mainId ? "map" : "object");
  const [obj, setObj] = useState<Obj | null>(null);
  const [main, setMain] = useState<Obj | null>(null);
  const [link, setLink] = useState<Connection | null | undefined>(undefined);
  useEffect(() => { setTab(paneId === mainId ? "map" : "object"); }, [paneId]);
  useEffect(() => { api.get(paneId).then(setObj).catch(() => setObj(null)); api.get(mainId).then(setMain).catch(() => setMain(null)); }, [paneId, mainId, tick]);
  useEffect(() => {
    if (paneId === mainId) { setLink(undefined); return; }
    api.connections(paneId).then((r) => setLink(r.find((c) => c.other.id === mainId) ?? null));
  }, [paneId, mainId, tick]);
  const beside = (id: string) => onNavigate(id);
  const typeDef = obj ? types.types.find((t) => t.key === obj.type) : undefined;
  return (
    <aside className="side-pane" aria-label="Second pane" style={obj ? typeVar(obj.type) : undefined}>
      <div className="sp-bar">
        <div className="sp-tabs" role="tablist">
          {(["object", "connections", "map"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {t === "object" ? "Object" : t === "connections" ? "Connections" : "Map"}
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="x" onClick={onClose} aria-label="Close the second pane"><Icon name="close" /></button>
      </div>
      {!obj ? <p className="quiet pad small">That Object is not here any more.</p> : (
        <>
          <div className="sp-head">
            {typeDef && <TypeChip type={obj.type} label={typeDef.label} />}
            <a className="sp-title" href={`#/o/${paneId}`}>{displayTitle(obj)}</a>
            {paneId !== mainId && main && (
              link === null ? (
                <button className="pill action" onClick={() => api.connect(paneId, mainId).then(refresh)}>
                  <Icon name="plus" /> Connect to “{displayTitle(main).slice(0, 24)}”
                </button>
              ) : link ? <span className="quiet small">{link.label} · {displayTitle(main).slice(0, 24)}</span> : null
            )}
            {paneId !== mainId && main && <ThoughtAbout a={mainId} b={paneId} />}
          </div>
          {tab === "object" && <SideObject id={paneId} types={types} onChanged={onChanged} beside={beside} />}
          {tab === "connections" && (
            <>
              <ConnectionsPanel obj={obj} types={types} beside={beside} />
              <SharesWords id={paneId} beside={beside} />
            </>
          )}
          {tab === "map" && (
            <>
              <MapView id={paneId} types={types} onOpen={(id, alt) => (alt ? beside(id) : onNavigate(id))} />
              <SharesWords id={paneId} beside={beside} />
            </>
          )}
        </>
      )}
    </aside>
  );
}

// The pane's Object tab is the Object's own words, read in place (the full page is one click away).
function SideObject({ id, types, onChanged, beside }: { id: string; types: Types; onChanged: () => void; beside: (id: string) => void }) {
  const [obj, setObj] = useState<Obj | null>(null);
  useEffect(() => { api.get(id).then(setObj); }, [id]);
  if (!obj) return <p className="quiet small">Opening…</p>;
  const lead = types.types.find((t) => t.key === obj.type)?.fields.find((f) => f.lead);
  const leadValue = lead ? obj.fields.find((f) => f.key === lead.key)?.value : undefined;
  void onChanged;
  return (
    <div className="sp-object">
      {leadValue && <p className="standfirst">{leadValue}</p>}
      {obj.tags.length > 0 && <div className="tags">{obj.tags.map((t) => <TagPill key={t.id} tag={t} />)}</div>}
      {obj.blocks.map((b) => (
        <p key={b.id} className={b.origin === "owner" ? "" : "b-src"}>
          <PlainBody text={b.text} mentions={obj.mentions ?? {}} beside={beside} />
        </p>
      ))}
      {!obj.blocks.length && <p className="quiet small">No words yet.</p>}
      <p><a className="pill action" href={`#/o/${id}`}><Icon name="expand" /> Open full page</a></p>
    </div>
  );
}

/** A body read-only: Mentions as quiet links (⌥-click opens beside), missing ones as plain marked text. */
function PlainBody({ text, mentions, beside }: { text: string; mentions: NonNullable<Obj["mentions"]>; beside: (id: string) => void }) {
  const parts = text.split(/(\[\[o:[0-9a-f-]{36}\]\])/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\[\[o:([0-9a-f-]{36})\]\]$/);
        if (!m) return p;
        const info = mentions[m[1]];
        if (!info || info.missing) return <span key={i} className="mention missing">{info?.inBin ? "in the Bin" : "missing Object"}</span>;
        return <a key={i} className="mention" style={typeVar(info.type!)} href={`#/o/${m[1]}`} onClick={openLink(m[1], beside)}><Icon name={info.type!} />{info.title}</a>;
      })}
    </>
  );
}

/** Merge two duplicates of the same type: pick the other, pick which one stays, answer any disagreement. */
export function MergeDialog({ obj, types, onDone, onClose }: { obj: Obj; types: Types; onDone: (keepId: string) => void; onClose: () => void }) {
  const [other, setOther] = useState<Found | null>(null);
  const [keepThis, setKeepThis] = useState(true);
  const [asks, setAsks] = useState<MergeAsk[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const label = types.types.find((t) => t.key === obj.type)!.label.toLowerCase();
  const mine = displayTitle(obj);

  const submit = async (p: Record<string, string>) => {
    if (!other) return;
    setBusy(true);
    try {
      const keepId = keepThis ? obj.id : other.id, fromId = keepThis ? other.id : obj.id;
      const r = await api.merge(keepId, fromId, p);
      if ("ask" in r) { setAsks(r.ask); setError(undefined); }
      else { refresh(); onDone(keepId); }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="scrim cap-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cw merge" role="dialog" aria-label="Merge duplicate">
        <div className="cw-top"><b>Merge a duplicate {label}</b><button className="x" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <div className="merge-body">
          {!other ? (
            <>
              <p className="quiet small">Pick the other {label} that is the same as “{mine}”.</p>
              <FindObject types={types} exclude={obj.id} onlyType={obj.type} action="Pick" onPick={setOther} onClose={onClose} />
            </>
          ) : !asks ? (
            <>
              <p>Which one stays?</p>
              <label className="radio"><input type="radio" checked={keepThis} onChange={() => setKeepThis(true)} /> Keep “{mine}”</label>
              <label className="radio"><input type="radio" checked={!keepThis} onChange={() => setKeepThis(false)} /> Keep “{other.title}”</label>
              <p className="quiet small">Every Connection, Tag and word of the other one moves to the one you keep, and Mentions of it follow. The other one goes to the Bin.</p>
            </>
          ) : (
            <>
              <p>Both have a Connection to the same Object, and they disagree. Which one should stay? Both notes are kept.</p>
              {asks.map((a) => (
                <fieldset key={a.otherId} className="ask">
                  <legend>{a.other.title}</legend>
                  <label className="radio"><input type="radio" name={a.otherId} checked={picks[a.otherId] === "keep"} onChange={() => setPicks({ ...picks, [a.otherId]: "keep" })} /> {a.keep.label}{a.keep.note && <span className="quiet small"> “{a.keep.note}”</span>}</label>
                  <label className="radio"><input type="radio" name={a.otherId} checked={picks[a.otherId] === "drop"} onChange={() => setPicks({ ...picks, [a.otherId]: "drop" })} /> {a.drop.label}{a.drop.note && <span className="quiet small"> “{a.drop.note}”</span>}</label>
                </fieldset>
              ))}
            </>
          )}
          {error && <p role="alert" className="quiet small">{error}</p>}
        </div>
        {other && (
          <div className="cw-foot">
            <button onClick={() => (asks ? setAsks(null) : setOther(null))}>Back</button>
            <span className="grow" />
            <button className="cw-save" disabled={busy || (!!asks && asks.some((a) => !picks[a.otherId]))} onClick={() => submit(asks ? picks : {})}>Merge</button>
          </div>
        )}
      </div>
    </div>
  );
}
