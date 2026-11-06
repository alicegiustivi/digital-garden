import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { api, type Types } from "./api";
import { Appearance, getAppearance, setAppearance, startFollowingMac } from "./theme";
import { TagsPage, ThisWeek, TypeList } from "./Lists";
import { ObjectPage } from "./ObjectPage";
import { Icon, typeVar } from "./ui";
import { Capture, captureKey, emptyDraft, isCaptureKey, type CaptureDraft } from "./Capture";

startFollowingMac();

const useHash = () => {
  const [hash, setHash] = useState(location.hash || "#/");
  useEffect(() => {
    const on = () => setHash(location.hash || "#/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
};
const go = (h: string) => { location.hash = h; };

const NAV = [
  { label: "This week", hash: "#/", type: null },
  { label: "Sources", hash: "#/sources", type: "source" },
  { label: "Concepts", hash: "#/concepts", type: "concept" },
  { label: "Thoughts", hash: "#/thoughts", type: "thought" },
  { label: "People", hash: "#/people", type: "person" },
  { label: "Tags", hash: "#/tags", type: null },
];
const TYPE_OF_ROUTE: Record<string, string> = { sources: "source", concepts: "concept", thoughts: "thought", people: "person" };

function TopBar({ hash, onCapture }: { hash: string; onCapture: () => void }) {
  const [open, setOpen] = useState(false);
  const [appearance, setAppearanceState] = useState<Appearance>(getAppearance());
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  const section = "#/" + hash.slice(2).split("/")[0];
  const choose = (a: Appearance) => { setAppearance(a); setAppearanceState(a); };
  return (
    <header className="mast wrap">
      <a className="wm" href="#/">Garden</a>
      <nav aria-label="Main">
        {NAV.map((n) => (
          <a key={n.hash} href={n.hash} style={n.type ? typeVar(n.type) : undefined} className={section === n.hash || (n.hash === "#/" && hash === "#/") ? "on" : ""}>
            {n.type && <Icon name={n.type} />}
            {n.label}
          </a>
        ))}
        <button className="cap" onClick={onCapture} title="Capture a thought"><Icon name="plus" /> Capture <kbd>{captureKey()}</kbd></button>
        <div className="more" ref={box}>
          <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>More <Icon name="chevron" /></button>
          {open && (
            <div className="menu" role="menu">
              <div className="menu-h">Appearance</div>
              {([["light", "Light"], ["dark", "Dark (Espresso)"], ["system", "Same as Mac"]] as [Appearance, string][]).map(([v, label]) => (
                <button key={v} role="menuitemradio" aria-checked={appearance === v} className={appearance === v ? "on" : ""} onClick={() => choose(v)}>
                  <span className="tick">{appearance === v ? "✓" : ""}</span>{label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}

function Peek({ id, ids, types, onChanged, onMove, onClose }: {
  id: string; ids: string[]; types: Types; onChanged: () => void; onMove: (id: string) => void; onClose: () => void;
}) {
  const i = ids.indexOf(id);
  const prev = i > 0 ? ids[i - 1] : null;
  const next = i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "Escape" && !typing) onClose();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowLeft" && prev) onMove(prev);
      if (e.key === "ArrowRight" && next) onMove(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose, onMove]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="peek" role="dialog" aria-label="Peek">
        <div className="peek-bar">
          <button disabled={!prev} onClick={() => prev && onMove(prev)} aria-label="Previous"><Icon name="left" /></button>
          <button disabled={!next} onClick={() => next && onMove(next)} aria-label="Next"><Icon name="right" /></button>
          <span className="quiet small">{i >= 0 ? `${i + 1} of ${ids.length}` : ""}</span>
          <span className="grow" />
          <button className="pill action" onClick={() => { onClose(); go(`#/o/${id}`); }}><Icon name="expand" /> Open full page</button>
          <button onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="peek-body"><ObjectPage key={id} id={id} types={types} onChanged={onChanged} /></div>
      </div>
    </div>
  );
}

function App() {
  const hash = useHash();
  const [types, setTypes] = useState<Types | null>(null);
  const [version, setVersion] = useState(0);
  const [peek, setPeek] = useState<{ id: string; ids: string[] } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => { api.types().then(setTypes); }, []);
  useEffect(() => setPeek(null), [hash]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isCaptureKey(e)) return;
      e.preventDefault();
      setPeek(null);
      setCapture(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!types) return <p className="quiet pad">Opening the Garden…</p>;

  const open = (id: string, ids: string[]) => setPeek({ id, ids });
  const make = async (type: string) => {
    const o = await api.create(type);
    setFresh(o.id);
    changed();
    go(`#/o/${o.id}`);
  };

  const parts = hash.slice(2).split("/");
  let page;
  if (parts[0] === "o" && parts[1]) {
    page = (
      <main className="wrap page">
        <ObjectPage key={parts[1]} id={parts[1]} types={types} fresh={fresh === parts[1]} onChanged={changed} />
      </main>
    );
  } else if (TYPE_OF_ROUTE[parts[0]]) {
    page = <TypeList typeKey={TYPE_OF_ROUTE[parts[0]]} types={types} version={version} onNew={make} onOpen={open} />;
  } else if (parts[0] === "tags") {
    page = <TagsPage tag={parts[1] ? decodeURIComponent(parts[1]) : undefined} types={types} version={version} onOpen={open} go={go} />;
  } else {
    page = <ThisWeek types={types} version={version} onNew={make} onOpen={open} />;
  }

  return (
    <>
      <TopBar hash={hash} onCapture={() => { setPeek(null); setCapture(true); }} />
      {page}
      {capture && (
        <Capture
          draft={draft}
          setDraft={setDraft}
          onClose={() => setCapture(false)}
          onSaved={changed}
          onOpen={(id) => { setCapture(false); setDraft({ ...draft, saved: null }); open(id, [id]); }}
        />
      )}
      {peek && <Peek id={peek.id} ids={peek.ids} types={types} onChanged={changed} onMove={(id) => setPeek({ ...peek, id })} onClose={() => setPeek(null)} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
