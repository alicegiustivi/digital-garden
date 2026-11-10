// PROTOTYPE (issue #116): throwaway. Three layouts of the writing space for a Piece, on made-up content, in memory only.
// Reach it at  #/prototype/writing-space?variant=A|B|C   (← → keys also switch). Nothing here talks to the server.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, typeVar } from "./ui";
import "./prototype-writing-space.css";

type TypeKey = "source" | "concept" | "thought" | "person";
type Mat = { id: string; type: TypeKey; title: string; sub?: string; text: string; links: { kind: string; to: string }[]; private?: boolean; origin?: "source" | "ai" };
type Block = { kind: "p" | "quote"; text: string; src?: string };

const MAT: Mat[] = [
  { id: "s1", type: "source", title: "On Reading Slowly", sub: "Essay · M. Okafor, 2021", origin: "source",
    text: "A reader who returns to the same page three times is not slower, only deeper: the second pass finds the argument, the third finds what the argument leaves out.",
    links: [{ kind: "supports", to: "t1" }, { kind: "authored by", to: "p1" }, { kind: "related", to: "c1" }] },
  { id: "s2", type: "source", title: "Notes from a reading experiment", sub: "Article · 2023", origin: "source",
    text: "Forty volunteers read the same chapter once or twice. Those who read it twice recalled fewer details but explained the main idea better.",
    links: [{ kind: "contradicts", to: "t1" }, { kind: "related", to: "c1" }] },
  { id: "c1", type: "concept", title: "Attention", sub: "Concept · 14 Objects",
    text: "My current view: attention is something you spend on purpose, and what it buys depends on what you do not read.",
    links: [{ kind: "related", to: "s1" }, { kind: "related", to: "s2" }, { kind: "builds on", to: "t2" }] },
  { id: "t1", type: "thought", title: "I remember what I reread, not what I skimmed", sub: "Thought",
    text: "Last month I reread the same chapter twice and could still explain it a week later. The things I skimmed are gone.",
    links: [{ kind: "supports", to: "c1" }] },
  { id: "t2", type: "thought", title: "Is slow reading just nostalgia?", sub: "Open Question",
    text: "Maybe I only like slow reading because it feels like how reading used to be.",
    links: [{ kind: "related", to: "s2" }] },
  { id: "p1", type: "person", title: "Maria Okafor", sub: "Person · writer",
    text: "Essayist who writes about reading habits. Author of “On Reading Slowly”.",
    links: [{ kind: "authored by", to: "s1" }] },
  { id: "x1", type: "thought", title: "What I actually do when I get bored", sub: "Thought", private: true,
    text: "(Private. The owner sees it; no AI ever does.)", links: [{ kind: "related", to: "t1" }] },
];
const byId = (id: string) => MAT.find((m) => m.id === id)!;
const TYPE_ORDER: TypeKey[] = ["source", "thought", "concept", "person"];
const TYPE_PLURAL: Record<TypeKey, string> = { source: "Sources", thought: "Thoughts", concept: "Concepts", person: "People" };

const START: Block[] = [
  { kind: "p", text: "I used to think I read a lot. Then I counted how much of it I could explain a week later, and the answer was embarrassing." },
  { kind: "p", text: "The first thing that changed my mind was {{s1}}, which says that a second pass finds the argument. That matches what I noticed when I {{t1}}." },
  { kind: "quote", src: "s1", text: "A reader who returns to the same page three times is not slower, only deeper." },
  { kind: "p", text: "" },
];
const PROJECT = { title: "Essays on attention", stage: "Active", about: "Why I read fewer things, twice.", pieces: [["Slow reading is a kind of attention", "Drafting"], ["The cost of the open tab", "Idea"], ["Reading on paper again", "Finished"]] as [string, string][] };

const mentionIds = (b: Block): string[] => (b.kind === "quote" ? [b.src!] : [...b.text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));

function Chip({ m }: { m: Mat }) {
  return <span className="chip" style={typeVar(m.type)}><Icon name={m.type} />{m.sub?.split(" · ")[0] ?? m.type}</span>;
}
function Origin({ m }: { m: Mat }) { return m.origin === "source" ? <span className="pw-origin" title="Source Origin: not your words">❝</span> : null; }

/** The page itself: the owner's words, Quotes and Mentions. Shared by all three variants; the surroundings differ. */
function Page({ blocks, setBlocks, hot, setHot, wide }: { blocks: Block[]; setBlocks: (b: Block[]) => void; hot: string | null; setHot: (id: string | null) => void; wide?: boolean }) {
  const set = (i: number, text: string) => setBlocks(blocks.map((b, j) => (j === i ? { ...b, text } : b)));
  return (
    <article className={`pw-page ${wide ? "wide" : ""}`}>
      <h1 className="pw-title" contentEditable suppressContentEditableWarning>Slow reading is a kind of attention</h1>
      {blocks.map((b, i) => (
        <div key={i} className={`pw-block ${b.kind} ${mentionIds(b).includes(hot ?? "") ? "hot" : ""}`}>
          {b.kind === "quote" ? (
            <blockquote onMouseEnter={() => setHot(b.src!)} onMouseLeave={() => setHot(null)}>
              <em>{b.text}</em>
              <cite>❝ {byId(b.src!).title}</cite>
            </blockquote>
          ) : (
            <Editable text={b.text} onCommit={(t) => set(i, t)} hot={hot} setHot={setHot} />
          )}
        </div>
      ))}
    </article>
  );
}

/** A paragraph: shows {{id}} as a quiet Mention link; click to edit as plain text. */
function Editable({ text, onCommit, setHot }: { text: string; onCommit: (t: string) => void; hot: string | null; setHot: (id: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.setSelectionRange(text.length, text.length); } }, [editing]);
  if (editing)
    return <textarea ref={ref} className="pw-edit" defaultValue={text} rows={Math.max(2, Math.ceil(text.length / 70))} onBlur={(e) => { onCommit(e.target.value); setEditing(false); }} />;
  const parts = text.split(/(\{\{\w+\}\})/);
  return (
    <p className="pw-p" onClick={() => setEditing(true)}>
      {text === "" && <span className="pw-ph">Keep writing, in your own words…</span>}
      {parts.map((s, i) => {
        const m = s.match(/^\{\{(\w+)\}\}$/);
        if (!m) return s;
        const o = byId(m[1]);
        return <a key={i} className="pw-mention" style={typeVar(o.type)} onMouseEnter={() => setHot(o.id)} onMouseLeave={() => setHot(null)} onClick={(e) => e.stopPropagation()}>{o.title}</a>;
      })}
    </p>
  );
}

function MaterialCard({ m, hot, setHot, onQuote, onMention, used, showLinks = true, dense }: { m: Mat; hot: string | null; setHot: (id: string | null) => void; onQuote: (id: string) => void; onMention: (id: string) => void; used: boolean; showLinks?: boolean; dense?: boolean }) {
  return (
    <div className={`pw-card ${hot === m.id ? "hot" : ""} ${used ? "used" : ""} ${dense ? "dense" : ""}`} style={typeVar(m.type)} onMouseEnter={() => setHot(m.id)} onMouseLeave={() => setHot(null)}>
      <div className="pw-card-h">
        <Chip m={m} />
        {m.private && <span className="pw-lock" title="Private: no AI reads this"><Icon name="lock" /></span>}
        {used && <span className="pw-used">in the piece</span>}
      </div>
      <div className="pw-card-t"><Origin m={m} /> {m.title}</div>
      {!dense && <div className={`pw-card-x ${m.origin === "source" ? "src" : ""}`}>{m.text}</div>}
      {showLinks && (
        <div className="pw-card-l">
          {m.links.map((l, i) => { const o = byId(l.to); return <span key={i} className="pw-link" style={typeVar(o.type)}>{l.kind} · {o.title}</span>; })}
        </div>
      )}
      <div className="pw-card-a">
        {m.type === "source" && <button onClick={() => onQuote(m.id)}>❝ Quote</button>}
        <button onClick={() => onMention(m.id)}>@ Mention</button>
      </div>
    </div>
  );
}

function Stage({ stage, setStage }: { stage: string; setStage: (s: string) => void }) {
  return (
    <span className="pw-stage" role="radiogroup" aria-label="Stage">
      {["Idea", "Drafting", "Finished"].map((s) => <button key={s} role="radio" aria-checked={stage === s} className={stage === s ? "on" : ""} onClick={() => setStage(s)}>{s}</button>)}
    </span>
  );
}
function ProjectStrip() {
  return <span className="pw-proj"><Icon name="book" /> part of <a>{PROJECT.title}</a> · {PROJECT.stage}</span>;
}
function AiHelp({ compact }: { compact?: boolean }) {
  return (
    <div className={`pw-ai ${compact ? "compact" : ""}`}>
      <div className="pw-ai-h"><Icon name="ai" /> Ask, when you want</div>
      <div className="pw-ai-b"><button>What here disagrees?</button><button>What's missing?</button><button>What does nothing support?</button></div>
      <p className="quiet small">Answers land beside your Piece as AI Notes ✦. Nothing is written for you.</p>
    </div>
  );
}
function Suggested() { return <p className="pw-sugg quiet small">✦ 1 suggested connection: “Notes from a reading experiment” → contradicts a Thought you used.</p>; }

/* ---------- Variant A: three panes, everything visible ---------- */
function VariantA(p: Ctx) {
  const { blocks, setBlocks, hot, setHot, stage, setStage } = p;
  return (
    <div className="pw-a">
      <aside className="pw-a-left">
        <h2>Material <span className="quiet small">connected to this Piece</span></h2>
        {TYPE_ORDER.map((t) => { const items = MAT.filter((m) => m.type === t); if (!items.length) return null; return (
          <section key={t}><h3>{TYPE_PLURAL[t]}</h3>{items.map((m) => <MaterialCard key={m.id} m={m} showLinks={false} used={p.used(m.id)} {...p.cardProps} />)}</section>); })}
      </aside>
      <main className="pw-a-mid">
        <div className="pw-bar"><Stage stage={stage} setStage={setStage} /><ProjectStrip /></div>
        <Page blocks={blocks} setBlocks={setBlocks} hot={hot} setHot={setHot} />
      </main>
      <aside className="pw-a-right">
        <h2>Connections</h2>
        {["supports", "contradicts", "builds on", "related", "authored by"].map((k) => {
          const rows = MAT.flatMap((m) => m.links.filter((l) => l.kind === k).map((l) => ({ m, l }))).slice(0, 3);
          return rows.length ? <section key={k}><h3>{k}</h3>{rows.map(({ m, l }, i) => <div key={i} className="pw-row" style={typeVar(m.type)} onMouseEnter={() => setHot(m.id)} onMouseLeave={() => setHot(null)}><Icon name={m.type} /> {m.title}<span className="quiet small"> → {byId(l.to).title}</span></div>)}</section> : null;
        })}
        <Suggested />
        <h2>In the Project</h2>
        <div className="pw-outline">{PROJECT.pieces.map(([t, s], i) => <div key={i} className={t.startsWith("Slow") ? "me" : ""}><span>{i + 1}</span>{t}<em>{s}</em></div>)}</div>
        <AiHelp />
      </aside>
    </div>
  );
}

/* ---------- Variant B: the page with notes in the margin, beside the paragraph that uses them ---------- */
function VariantB(p: Ctx) {
  const { blocks, setBlocks, hot, setHot, stage, setStage } = p;
  const usedIds = new Set(blocks.flatMap(mentionIds));
  const spare = MAT.filter((m) => !usedIds.has(m.id));
  return (
    <div className="pw-b">
      <div className="pw-b-head"><Stage stage={stage} setStage={setStage} /><ProjectStrip /><span className="quiet small">About: {PROJECT.about}</span></div>
      <div className="pw-b-grid">
        {blocks.map((b, i) => (
          <div className="pw-b-row" key={i}>
            <div className="pw-b-text"><Page blocks={[b]} setBlocks={(nb) => setBlocks(blocks.map((x, j) => (j === i ? nb[0] : x)))} hot={hot} setHot={setHot} wide /></div>
            <div className="pw-b-margin">{[...new Set(mentionIds(b))].map((id) => <MaterialCard key={id} m={byId(id)} used={false} {...p.cardProps} />)}</div>
          </div>
        ))}
      </div>
      <section className="pw-b-tray">
        <h2>Not used yet <span className="quiet small">connected, not in the text</span></h2>
        <div className="pw-b-trayrow">{spare.map((m) => <MaterialCard key={m.id} m={m} used={false} {...p.cardProps} />)}</div>
        <Suggested /><AiHelp compact />
      </section>
    </div>
  );
}

/* ---------- Variant C: the page on the left, the Piece's neighbourhood (map + material with their own connections) on the right ---------- */
function Hood({ hot, setHot }: { hot: string | null; setHot: (id: string | null) => void }) {
  const W = 340, H = 230, cx = W / 2, cy = H / 2;
  const pos = (i: number, n: number, r: number) => ({ x: cx + r * Math.cos((i / n) * 2 * Math.PI - Math.PI / 2), y: cy + r * 0.72 * Math.sin((i / n) * 2 * Math.PI - Math.PI / 2) });
  const nodes = MAT.map((m, i) => ({ m, ...pos(i, MAT.length, 120) }));
  const at = (id: string) => nodes.find((n) => n.m.id === id)!;
  return (
    <svg className="pw-hood" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="The Piece and what is connected to it">
      {nodes.map((n) => <line key={n.m.id} x1={cx} y1={cy} x2={n.x} y2={n.y} className={hot === n.m.id ? "hot" : ""} />)}
      {nodes.flatMap((n) => n.m.links.map((l, i) => (l.to > n.m.id ? <line key={n.m.id + i} className="faint" x1={n.x} y1={n.y} x2={at(l.to).x} y2={at(l.to).y} /> : null)))}
      <circle cx={cx} cy={cy} r={22} className="me" />
      <text x={cx} y={cy + 4} textAnchor="middle" className="me-t">Piece</text>
      {nodes.map((n) => (
        <g key={n.m.id} style={typeVar(n.m.type)} onMouseEnter={() => setHot(n.m.id)} onMouseLeave={() => setHot(null)} className={hot === n.m.id ? "hot" : ""}>
          <circle cx={n.x} cy={n.y} r={hot === n.m.id ? 12 : 9} className="node" />
          <text x={n.x} y={n.y + 24} textAnchor="middle" className="lab">{n.m.title.length > 22 ? n.m.title.slice(0, 20) + "…" : n.m.title}</text>
        </g>
      ))}
    </svg>
  );
}
function VariantC(p: Ctx) {
  const { blocks, setBlocks, hot, setHot, stage, setStage } = p;
  return (
    <div className="pw-c">
      <div className="pw-c-page">
        <div className="pw-bar"><Stage stage={stage} setStage={setStage} /><ProjectStrip /></div>
        <Page blocks={blocks} setBlocks={setBlocks} hot={hot} setHot={setHot} wide />
        <AiHelp compact />
      </div>
      <aside className="pw-c-hood">
        <h2>Around this Piece</h2>
        <Hood hot={hot} setHot={setHot} />
        <Suggested />
        <div className="pw-c-stack">{MAT.map((m) => <MaterialCard key={m.id} m={m} used={p.used(m.id)} {...p.cardProps} />)}</div>
      </aside>
    </div>
  );
}

type Ctx = { blocks: Block[]; setBlocks: (b: Block[]) => void; hot: string | null; setHot: (id: string | null) => void; stage: string; setStage: (s: string) => void; used: (id: string) => boolean; cardProps: { hot: string | null; setHot: (id: string | null) => void; onQuote: (id: string) => void; onMention: (id: string) => void } };

const VARIANTS: [string, string, (c: Ctx) => ReactNode][] = [
  ["A", "Three panes", VariantA],
  ["B", "Margin notes", VariantB],
  ["C", "Page and neighbourhood", VariantC],
];

export function PrototypeWritingSpace({ hash }: { hash: string }) {
  const q = new URLSearchParams(hash.split("?")[1] ?? "");
  const variant = (q.get("variant") ?? "A").toUpperCase();
  const idx = Math.max(0, VARIANTS.findIndex((v) => v[0] === variant));
  const [blocks, setBlocks] = useState<Block[]>(START);
  const [stage, setStage] = useState("Drafting");
  const [hot, setHot] = useState<string | null>(null);
  const go = (i: number) => { location.hash = `#/prototype/writing-space?variant=${VARIANTS[(i + VARIANTS.length) % VARIANTS.length][0]}`; };
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "ArrowLeft") go(idx - 1);
      if (e.key === "ArrowRight") go(idx + 1);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [idx]);

  const withEnd = (b: Block) => { const last = blocks[blocks.length - 1]; setBlocks(last && last.kind === "p" && last.text === "" ? [...blocks.slice(0, -1), b, last] : [...blocks, b, { kind: "p", text: "" }]); };
  const onQuote = (id: string) => withEnd({ kind: "quote", src: id, text: byId(id).text.split(/(?<=[.!?])\s/)[0] });
  const onMention = (id: string) => {
    const i = [...blocks].reverse().findIndex((b) => b.kind === "p");
    if (i < 0) return;
    const at = blocks.length - 1 - i;
    setBlocks(blocks.map((b, j) => (j === at ? { ...b, text: `${b.text}${b.text && !b.text.endsWith(" ") ? " " : ""}{{${id}}}` } : b)));
  };
  const used = (id: string) => blocks.some((b) => mentionIds(b).includes(id));
  const ctx: Ctx = { blocks, setBlocks, hot, setHot, stage, setStage, used, cardProps: { hot, setHot, onQuote, onMention } };

  return (
    <main className="page pw-root">
      <p className="pw-banner">PROTOTYPE · made-up content, nothing is saved · click a paragraph to edit, ❝ Quote and @ Mention add to the text, hover anything to light up where it is used</p>
      {VARIANTS[idx][2](ctx)}
      <div className="pw-switch" role="group" aria-label="Prototype variants">
        <button onClick={() => go(idx - 1)} aria-label="Previous variant">←</button>
        <span>{VARIANTS[idx][0]} · {VARIANTS[idx][1]}</span>
        <button onClick={() => go(idx + 1)} aria-label="Next variant">→</button>
      </div>
    </main>
  );
}
