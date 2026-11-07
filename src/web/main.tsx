import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { api, type Types } from "./api";
import { Appearance, getAppearance, setAppearance, startFollowingMac } from "./theme";
import { TagsPage, ThisWeek, TypeList, UnreviewedPage, useList } from "./Lists";
import { ObjectPage } from "./ObjectPage";
import { SidePane } from "./Connections";
import { useRefresh } from "./refresh";
import { Toasts } from "./toast";
import { BinPage } from "./Bin";
import { AiLine, AiPage, aiChanged } from "./Ai";
import type { Summary } from "./api";
import { Icon, typeVar } from "./ui";
import { Palette, SearchPage } from "./Search";
import { TimelinePage } from "./Timeline";
import { OverviewPage } from "./Overview";
import { addRecent } from "./recent";
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
  { label: "Overview", hash: "#/overview", type: null },
  { label: "This week", hash: "#/", type: null },
  { label: "Sources", hash: "#/sources", type: "source" },
  { label: "Concepts", hash: "#/concepts", type: "concept" },
  { label: "Thoughts", hash: "#/thoughts", type: "thought" },
  { label: "People", hash: "#/people", type: "person" },
  { label: "Tags", hash: "#/tags", type: null },
  { label: "Timeline", hash: "#/timeline", type: null },
];
const TYPE_OF_ROUTE: Record<string, string> = { sources: "source", concepts: "concept", thoughts: "thought", people: "person" };

function TopBar({ hash, unreviewed, onCapture, onSearch }: { hash: string; unreviewed: number; onCapture: () => void; onSearch: () => void }) {
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
  const section = "#/" + hash.slice(2).split("?")[0].split("/")[0];
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
        <a href="#/unreviewed" className={section === "#/unreviewed" ? "on" : ""}>Unreviewed ({unreviewed})</a>
        <button className="cap search-btn" onClick={onSearch} title="Search everything"><Icon name="search" /> Search <kbd>⌘K</kbd></button>
        <button className="cap" onClick={onCapture} title="Capture a thought"><Icon name="plus" /> Capture <kbd>{captureKey()}</kbd></button>
        <AiLine />
        <div className="more" ref={box}>
          <button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>More <Icon name="chevron" /></button>
          {open && (
            <div className="menu" role="menu">
              <a className="menu-link" href="#/bin" onClick={() => setOpen(false)}><span className="tick" />Bin</a>
              <a className="menu-link" href="#/ai" onClick={() => setOpen(false)}><span className="tick" />AI</a>
              <a className="menu-link" href="#/bookmark" onClick={() => setOpen(false)}><span className="tick" />Save to Garden bookmark</a>
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

function BookmarkPage() {
  const link = useRef<HTMLAnchorElement>(null);
  // The bookmark is a tiny script, so it has to be set directly (React won't put a javascript: link in a page).
  useEffect(() => {
    const code = `(function(){window.open('${location.origin}/#/capture?url='+encodeURIComponent(location.href),'garden-capture','width=640,height=620');})();`;
    link.current?.setAttribute("href", "javascript:" + encodeURIComponent(code));
  }, []);
  return (
    <main className="wrap page bookmark-page">
      <h2>Save to Garden</h2>
      <p className="quiet">One click in your browser sends the page you're reading to Capture, with its link already filled in.</p>
      <ol>
        <li>Show your browser's bookmarks bar (in Chrome or Safari: View ▸ Show Bookmarks Bar).</li>
        <li>Drag this button onto the bar: <a ref={link} className="bookmark-btn" onClick={(e) => e.preventDefault()}>Save to Garden</a></li>
        <li>On any page, click it. A small Capture window opens. Press Save ⌘↩.</li>
      </ol>
      <p className="quiet small">It only talks to this Garden on your Mac ({location.origin}).</p>
    </main>
  );
}

/** What an Unreviewed capture shows above its page: the Archivist's status line and the "From the Archivist" block. The Archivist's status line is shown on the page below. */
function ReviewShell({ o }: { o: Summary }) {
  return (
    <div className="review-shell">
      <section className="from-archivist" aria-label="From the Archivist">
        <h4>From the Archivist</h4>
        <p className="quiet small">{o.private ? "Private: no AI reads this, so there is nothing to show." : "What the Archivist adds (facts and Tags) is marked ✦ on the page below, with Undo. Its proposals for Connections will appear here in a later build."}</p>
      </section>
    </div>
  );
}

function Peek({ id, ids, types, pending, onChanged, onMove, onReview, onClose }: {
  id: string; ids: string[]; types: Types; pending: Summary | undefined; onChanged: () => void; onMove: (id: string) => void; onReview: () => void; onClose: () => void;
}) {
  const i = ids.indexOf(id);
  const prev = i > 0 ? ids[i - 1] : null;
  const next = i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]");
      if (e.key === "Escape" && !typing) onClose();
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "r" || e.key === "R") && pending) onReview();
      if (e.key === "ArrowLeft" && prev) onMove(prev);
      if (e.key === "ArrowRight" && next) onMove(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, onClose, onMove, pending, onReview]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="peek" role="dialog" aria-label="Peek">
        <div className="peek-bar">
          <button disabled={!prev} onClick={() => prev && onMove(prev)} aria-label="Previous"><Icon name="left" /></button>
          <button disabled={!next} onClick={() => next && onMove(next)} aria-label="Next"><Icon name="right" /></button>
          <span className="quiet small">{i >= 0 ? `${i + 1} of ${ids.length}` : ""}</span>
          <span className="grow" />
          {pending && <button className="pill action reviewed" onClick={onReview}>✓ Reviewed <kbd>R</kbd></button>}
          <button className="pill action" onClick={() => { onClose(); go(`#/o/${id}`); }}><Icon name="expand" /> Open full page</button>
          <button onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <div className="peek-body">{pending && <ReviewShell o={pending} />}<ObjectPage key={id} id={id} types={types} onChanged={onChanged} beside={(b) => go(`#/o/${id}/with/${b}`)} onDeleted={onClose} /></div>
      </div>
    </div>
  );
}

function App() {
  const hash = useHash();
  const [types, setTypes] = useState<Types | null>(null);
  const [version, setVersion] = useState(0);
  const [peek, setPeek] = useState<{ id: string; ids: string[]; fromUnreviewed?: boolean } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [searching, setSearching] = useState(false);
  const [draft, setDraft] = useState<CaptureDraft>(emptyDraft);
  const changed = useCallback(() => setVersion((v) => v + 1), []);
  const unreviewed = useList({ unreviewed: "1" }, version);
  // A Connection changed somewhere on screen: lists and counts reload.
  const connectionsTick = useRefresh();
  useEffect(() => { if (connectionsTick) changed(); }, [connectionsTick, changed]);
  useEffect(() => { api.types().then(setTypes); }, []);
  useEffect(() => setPeek(null), [hash]);
  // Objects opened lately sit in ⌘K.
  useEffect(() => { const m = hash.match(/^#\/o\/([0-9a-f-]{36})/); if (m) addRecent(m[1]); }, [hash]);
  useEffect(() => { if (peek) addRecent(peek.id); }, [peek?.id]);
  // "Save to Garden" bookmark: #/capture?url=… opens the window with that page's link already in it.
  useEffect(() => {
    if (!hash.startsWith("#/capture")) return;
    const url = new URLSearchParams(hash.split("?")[1] ?? "").get("url");
    history.replaceState(null, "", "#/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    if (url && /^https?:\/\//i.test(url)) {
      setDraft((d) => ({ ...d, links: d.links.includes(url) ? d.links : [...d.links, url], from: new URL(url).hostname.replace(/^www\./, ""), saved: null }));
      setCapture(true);
    }
  }, [hash]);
  // ⌘K searches; ⌘[ and ⌘] go back and forward.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key === "k") { e.preventDefault(); setPeek(null); setCapture(false); setSearching((s) => !s); }
      else if (e.key === "[") { e.preventDefault(); history.back(); }
      else if (e.key === "]") { e.preventDefault(); history.forward(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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

  const open = (id: string, ids: string[]) => setPeek({ id, ids, fromUnreviewed: location.hash.startsWith("#/unreviewed") });
  const review = async (ids: string[]) => { await api.reviewed(ids); changed(); };
  // Reviewed from the Unreviewed list also moves on to the next one (or the previous, at the end).
  const reviewPeeked = async () => {
    if (!peek) return;
    await review([peek.id]);
    if (!peek.fromUnreviewed) return;
    const i = peek.ids.indexOf(peek.id);
    const rest = peek.ids.filter((x) => x !== peek.id);
    const nextId = rest[i] ?? rest[i - 1];
    setPeek(nextId ? { ...peek, id: nextId, ids: rest } : null);
  };
  const make = async (type: string) => {
    const o = await api.create(type);
    setFresh(o.id);
    changed();
    go(`#/o/${o.id}`);
  };

  const parts = hash.slice(2).split("?")[0].split("/");
  let page;
  if (parts[0] === "o" && parts[1]) {
    const mainId = parts[1];
    const paneId = parts[2] === "with" ? parts[3] : undefined;
    const beside = (b: string) => go(`#/o/${mainId}/with/${b}`);
    page = (
      <main className={`wrap page ${paneId ? "split" : ""}`}>
        <div className="split-main">
          <ObjectPage key={mainId} id={mainId} types={types} fresh={fresh === mainId} onChanged={changed} beside={beside} onDeleted={() => go("#/")} />
        </div>
        {paneId && <SidePane paneId={paneId} mainId={mainId} types={types} onNavigate={beside} onClose={() => go(`#/o/${mainId}`)} onChanged={changed} />}
      </main>
    );
  } else if (TYPE_OF_ROUTE[parts[0]]) {
    page = <TypeList typeKey={TYPE_OF_ROUTE[parts[0]]} types={types} version={version} onNew={make} onOpen={open} />;
  } else if (parts[0] === "search") {
    page = <SearchPage key={hash} hash={hash} types={types} version={version} onOpen={open} />;
  } else if (parts[0] === "overview") {
    page = <OverviewPage types={types} version={version} onOpen={open} go={go} onChanged={changed} />;
  } else if (parts[0] === "timeline") {
    page = <TimelinePage types={types} version={version} onOpen={open} />;
  } else if (parts[0] === "unreviewed") {
    page = <UnreviewedPage rows={unreviewed} types={types} onOpen={open} onReviewed={review} />;
  } else if (parts[0] === "bin") {
    page = <BinPage types={types} onChanged={changed} />;
  } else if (parts[0] === "ai") {
    page = <AiPage />;
  } else if (parts[0] === "bookmark") {
    page = <BookmarkPage />;
  } else if (parts[0] === "tags") {
    page = <TagsPage tag={parts[1] ? decodeURIComponent(parts[1]) : undefined} types={types} version={version} onOpen={open} go={go} onChanged={changed} />;
  } else {
    page = <ThisWeek types={types} version={version} unreviewed={unreviewed?.length ?? 0} onNew={make} onOpen={open} />;
  }

  return (
    <>
      <TopBar hash={hash} unreviewed={unreviewed?.length ?? 0} onCapture={() => { setPeek(null); setCapture(true); }} onSearch={() => { setPeek(null); setSearching(true); }} />
      {page}
      <Toasts />
      {capture && (
        <Capture
          draft={draft}
          setDraft={setDraft}
          onClose={() => { setCapture(false); api.aiFlush().then(aiChanged).catch(() => {}); }}
          onSaved={changed}
          onOpen={(id) => { setCapture(false); api.aiFlush().catch(() => {}); setDraft((d) => ({ ...d, saved: null })); open(id, [id]); }}
        />
      )}
      {searching && <Palette types={types} onClose={() => setSearching(false)} go={go} />}
      {peek && <Peek id={peek.id} ids={peek.ids} types={types} pending={unreviewed?.find((u) => u.id === peek.id)} onReview={reviewPeeked} onChanged={changed} onMove={(id) => setPeek({ ...peek, id })} onClose={() => setPeek(null)} />}
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
