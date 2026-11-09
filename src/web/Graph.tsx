// The Map (issue #82): the whole Garden drawn as one graph, clustered by Concept, with filters that fade the rest; and a
// full-size graph around one Object with a "how far out" control. Chosen from the #68 prototype (directions B and A).
// Read-only: nothing here changes the Garden. All drawing and layout is local; no AI. The owner's own view, so Private
// Objects are drawn (with a lock) and Objects in the Bin are not.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGraph, type GraphData, type GraphEdge, type GraphNode, type Types } from "./api";
import { adjacency, conceptHomes, degrees, neighbourhood } from "./graph-math";
import { typeVar } from "./ui";

/* ---------- a tiny force layout (no library) ---------- */
type SN = { id: string; x: number; y: number; vx: number; vy: number; r: number; fixed?: boolean; ax?: number; ay?: number; as?: number; ring?: number };
type SL = { a: SN; b: SN; w: number; len: number };
const lastPos = new Map<string, { x: number; y: number }>();
class Sim {
  alpha = 1;
  constructor(public nodes: SN[], public links: SL[], public o: { charge: number; center: number }) {}
  step() {
    const { nodes, links, o } = this, n = nodes.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = nodes[i], b = nodes[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy;
      if (d2 > 160000) continue; if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
      const d = Math.sqrt(d2), minD = a.r + b.r + 6, f = (o.charge / Math.max(d2, 150)) + (d < minD ? (minD - d) * .2 : 0);
      const fx = (dx / d) * f, fy = (dy / d) * f; a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
    for (const l of links) {
      const dx = l.b.x - l.a.x, dy = l.b.y - l.a.y, d = Math.sqrt(dx * dx + dy * dy) || 1, f = (d - l.len) * .04 * l.w, fx = (dx / d) * f, fy = (dy / d) * f;
      l.a.vx += fx; l.a.vy += fy; l.b.vx -= fx; l.b.vy -= fy;
    }
    for (const p of nodes) {
      if (p.ax !== undefined && p.ay !== undefined) { p.vx += (p.ax - p.x) * (p.as ?? .02); p.vy += (p.ay - p.y) * (p.as ?? .02); }
      if (p.ring !== undefined) { const r = Math.hypot(p.x, p.y) || 1, k = (p.ring - r) / r * .05; p.vx += p.x * k; p.vy += p.y * k; }
      p.vx -= p.x * o.center; p.vy -= p.y * o.center;
      if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
      p.vx = Math.max(-60, Math.min(60, p.vx * .82)); p.vy = Math.max(-60, Math.min(60, p.vy * .82)); p.x += p.vx * Math.max(this.alpha, .15); p.y += p.vy * Math.max(this.alpha, .15);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) { p.x = (Math.random() - .5) * 200; p.y = (Math.random() - .5) * 200; p.vx = p.vy = 0; }
    }
    this.alpha *= .985;
  }
}
function useSim(key: string, build: () => Sim, remember = true) {
  const [, setTick] = useState(0);
  const simRef = useRef<Sim | null>(null);
  const raf = useRef(0);
  const sim = useMemo(() => { const s = build(); for (const nn of remember ? s.nodes : []) { const p = lastPos.get(nn.id); if (p) { nn.x = p.x; nn.y = p.y; s.alpha = Math.min(s.alpha, .5); } } for (let i = 0; i < 60; i++) s.step(); simRef.current = s; return s; }, [key]); // eslint-disable-line
  useEffect(() => {
    const loop = () => { for (let i = 0; i < 2; i++) sim.step(); if (remember) for (const nn of sim.nodes) lastPos.set(nn.id, { x: nn.x, y: nn.y }); setTick((t) => t + 1); if (sim.alpha > .02) raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [sim]);
  const reheat = () => { sim.alpha = Math.max(sim.alpha, .5); cancelAnimationFrame(raf.current); const loop = () => { for (let i = 0; i < 2; i++) sim.step(); setTick((t) => t + 1); if (sim.alpha > .02) raf.current = requestAnimationFrame(loop); }; raf.current = requestAnimationFrame(loop); };
  return { sim, reheat };
}

/* ---------- the drawing surface (zoom, pan, drag, labels) ---------- */
export type Item = { id: string; label: string; type: string; r: number; private?: boolean; fade: number; concept?: boolean; rank: number; sub?: string };
export type Link = { key: string; a: string; b: string; kind: string; origin: string; approved: boolean; fade: number; width?: number; note?: string };
const DASH: Record<string, string | undefined> = { related: undefined, supports: undefined, "builds on": undefined, "inspired by": "1 4", contradicts: "7 4", mentions: "2 3", "authored by": "10 3 2 3" };
const DIRECTED = new Set(["supports", "builds on", "inspired by", "authored by", "mentions"]);

function Canvas({ sim, items, links, under, onNode, onNodeDouble, edgeLabels, selected, labelBudget, onReheat, initialK = 1, noFit }: {
  sim: Sim; items: Item[]; links: Link[]; under?: (pos: (id: string) => SN | undefined) => React.ReactNode; onNode: (id: string, e: React.MouseEvent) => void; onNodeDouble?: (id: string) => void;
  edgeLabels: "all" | "hover" | "zoom"; selected?: string | null; labelBudget: (k: number) => number; onReheat: () => void; initialK?: number; noFit?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ k: initialK, x: 0, y: 0 });
  const [size, setSize] = useState({ w: 900, h: 600 });
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ kind: "pan" | "node"; id?: string; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  useEffect(() => { const ro = new ResizeObserver(() => box.current && setSize({ w: box.current.clientWidth, h: box.current.clientHeight })); ro.observe(box.current!); return () => ro.disconnect(); }, []);
  const byId = useMemo(() => new Map(sim.nodes.map((n) => [n.id, n])), [sim]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const nbrs = useMemo(() => { const m = new Map<string, Set<string>>(); for (const l of links) { (m.get(l.a) ?? m.set(l.a, new Set()).get(l.a)!).add(l.b); (m.get(l.b) ?? m.set(l.b, new Set()).get(l.b)!).add(l.a); } return m; }, [links]);
  const focusId = hover ?? selected ?? null;
  const lit = focusId ? new Set([focusId, ...(nbrs.get(focusId) ?? [])]) : null;
  const toWorld = (cx: number, cy: number) => { const r = box.current!.getBoundingClientRect(); return { x: (cx - r.left - size.w / 2 - view.x) / view.k, y: (cy - r.top - size.h / 2 - view.y) / view.k }; };
  const onWheel = (e: React.WheelEvent) => {
    const r = box.current!.getBoundingClientRect(); const px = e.clientX - r.left - size.w / 2, py = e.clientY - r.top - size.h / 2;
    const k = Math.min(6, Math.max(.2, view.k * Math.exp(-e.deltaY * .0015)));
    setView({ k, x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k });
  };
  const down = (e: React.PointerEvent, id?: string) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: id ? "node" : "pan", id, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
    if (id) e.stopPropagation();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
    if (d.kind === "pan") setView({ ...view, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy });
    else if (d.moved && d.id) { const n = byId.get(d.id)!; const w = toWorld(e.clientX, e.clientY); n.x = w.x; n.y = w.y; n.vx = 0; n.vy = 0; n.fixed = true; onReheat(); }
  };
  const up = (e: React.PointerEvent, id?: string) => {
    const d = drag.current; drag.current = null; if (!d) return;
    if (d.kind === "node" && d.id) { const n = byId.get(d.id)!; if (d.moved) { n.fixed = false; } else if (id) onNode(id, e as unknown as React.MouseEvent); }
  };
  // Which labels to draw: the biggest first, as many as zoom allows; plus the one you point at and what it touches.
  const ranked = useMemo(() => [...items].sort((a, b) => b.rank - a.rank), [items]);
  const budget = labelBudget(view.k);
  // Names are placed biggest first, and one is skipped when it would sit on top of a name already placed.
  const labelled = new Set<string>();
  { const boxes: [number, number, number, number][] = [];
    for (const i of ranked) {
      if (labelled.size >= budget) break; if (i.fade <= .5) continue;
      const n = byId.get(i.id); if (!n) continue;
      const w = Math.min(i.label.length, 34) * (i.concept ? 7.2 : 6) + 6, x = size.w / 2 + view.x + n.x * view.k, y = size.h / 2 + view.y + n.y * view.k + i.r * view.k + 2;
      if (x < -w || x > size.w + w || y < -20 || y > size.h + 20) continue;
      const b: [number, number, number, number] = [x - w / 2, y, x + w / 2, y + 14];
      if (boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b); labelled.add(i.id);
    } }
  const s = 1 / view.k;
  const fitAll = (only?: Set<string>) => { const ns = sim.nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && (!only || only.has(n.id))); if (!ns.length || size.h < 50) return false; const mx = ns.reduce((a, n) => a + n.x, 0) / ns.length, my = ns.reduce((a, n) => a + n.y, 0) / ns.length; const ds = ns.map((n) => Math.hypot(n.x - mx, n.y - my)).sort((a, b) => a - b); const lim = only ? Math.max(120, (ds[Math.floor(ds.length / 2)] ?? 0) * 2.6) : Infinity; const kept = ns.filter((n) => Math.hypot(n.x - mx, n.y - my) <= lim); const xs = kept.map((n) => n.x), ys = kept.map((n) => n.y); const w = Math.max(...xs) - Math.min(...xs) + 160, h = Math.max(...ys) - Math.min(...ys) + 160; setView({ k: Math.min(size.w / w, size.h / h, 2), x: -((Math.max(...xs) + Math.min(...xs)) / 2) * Math.min(size.w / w, size.h / h, 2), y: -((Math.max(...ys) + Math.min(...ys)) / 2) * Math.min(size.w / w, size.h / h, 2) }); return true; };
  // When a filter lights only some Objects, zoom to them; when it is cleared, show everything again.
  const litKey = items.filter((i) => i.fade > .5).map((i) => i.id).join(",");
  const lastLit = useRef(litKey);
  useEffect(() => { if (lastLit.current === litKey || noFit) return; lastLit.current = litKey; const lit = new Set(items.filter((i) => i.fade > .5).map((i) => i.id)); setTimeout(() => fitAll(lit.size && lit.size < items.length ? lit : undefined), 700); }); // eslint-disable-line
  const fits = useRef(0);
  const lastSim = useRef(sim);
  if (lastSim.current !== sim) { lastSim.current = sim; fits.current = 0; }
  useEffect(() => { if (size.h < 50 || noFit) return; if (fits.current === 0 || (fits.current === 1 && sim.alpha < .1)) { fitAll(); fits.current++; } });
  const showEdge = (l: Link) => edgeLabels === "all" ? view.k > .5 : edgeLabels === "zoom" ? view.k > 1.6 : false;
  return (
    <div className="gx-canvas" ref={box} onWheel={onWheel}>
      <svg width={size.w} height={size.h} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={(e) => up(e)} onPointerLeave={() => (drag.current = null)} role="img" aria-label="Graph of how the Objects in the Garden connect">
        <defs>
          <marker id="gx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="context-stroke" /></marker>
        </defs>
        <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
          {under?.((id) => byId.get(id))}
          {links.map((l) => {
            const a = byId.get(l.a), b = byId.get(l.b); if (!a || !b) return null;
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            const hot = lit ? lit.has(l.a) && lit.has(l.b) && (l.a === focusId || l.b === focusId) : false;
            const op = (lit ? (hot ? 1 : .05) : .32) * l.fade;
            const ra = (itemById.get(l.a)?.r ?? 6) + 1, rb = (itemById.get(l.b)?.r ?? 6) + 4;
            const x1 = a.x + (dx / d) * ra, y1 = a.y + (dy / d) * ra, x2 = b.x - (dx / d) * rb, y2 = b.y - (dy / d) * rb, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const ai = l.origin === "ai";
            const label = (hot || showEdge(l)) && l.fade > .5;
            return (
              <g key={l.key} opacity={op}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={`gx-edge k-${l.kind.replace(" ", "-")}`} strokeDasharray={DASH[l.kind]} strokeWidth={(l.width ?? 1.2) } vectorEffect="non-scaling-stroke" markerEnd={DIRECTED.has(l.kind) && view.k > .55 ? "url(#gx-arrow)" : undefined} />
                {(label || (ai && view.k > 1.1 && l.fade > .5)) && (
                  <text x={mx} y={my} className="gx-elabel" fontSize={10 * s} textAnchor="middle" dy={3 * s}>
                    <tspan className="gx-halo">{label ? l.kind : ""}{ai ? (label ? " " : "") + (l.approved ? "✧" : "✦") : ""}</tspan>
                  </text>
                )}
                {l.note && label && <title>{l.note}</title>}
              </g>
            );
          })}
          {items.map((it) => {
            const n = byId.get(it.id); if (!n) return null;
            const dim = lit ? (lit.has(it.id) ? 1 : .12) : 1; const op = Math.min(dim, it.fade);
            const show = labelled.has(it.id) || (lit?.has(it.id) && it.fade > .5) || it.id === selected || it.id === hover;
            return (
              <g key={it.id} transform={`translate(${n.x} ${n.y})`} opacity={op} style={{ ...typeVar(it.type), cursor: "pointer" }}
                onPointerDown={(e) => down(e, it.id)} onPointerUp={(e) => up(e, it.id)} onPointerEnter={() => setHover(it.id)} onPointerLeave={() => setHover(null)} onDoubleClick={() => onNodeDouble?.(it.id)}>
                {it.id === selected && <circle r={it.r + 5} className="gx-sel" />}
                <circle r={it.r} className={`gx-node ${it.concept ? "concept" : ""}`} />
                {it.private && <g transform={`scale(${Math.max(.6, Math.min(1.2, it.r / 9))}) translate(-5 -5)`} className="gx-lock"><rect x="1" y="4.5" width="8" height="5.5" rx="1.4" /><path d="M2.8 4.5V3.2a2.2 2.2 0 0 1 4.4 0v1.3" /></g>}
                {show && (
                  <text y={it.r + 11 * s} textAnchor="middle" fontSize={(it.concept ? 13 : 11) * s} className={`gx-label ${it.concept ? "concept" : ""}`}>
                    <tspan className="gx-halo">{it.label.length > 34 ? it.label.slice(0, 33) + "…" : it.label}</tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="gx-zoom">
        <button onClick={() => setView({ ...view, k: Math.min(6, view.k * 1.4) })} aria-label="Zoom in">+</button>
        <button onClick={() => setView({ ...view, k: Math.max(.2, view.k / 1.4) })} aria-label="Zoom out">−</button>
        <button onClick={() => fitAll()} aria-label="Fit everything">Fit</button>
      </div>
      {hover && itemById.get(hover) && (
        <div className="gx-hover" style={typeVar(itemById.get(hover)!.type)}>
          <b>{itemById.get(hover)!.label}</b> {itemById.get(hover)!.sub && <span className="quiet small">{itemById.get(hover)!.sub}</span>}
          <span className="quiet small"> · click: peek · ⌥-click: second pane</span>
        </div>
      )}
    </div>
  );
}

/* ---------- shared bits ---------- */
type Tools = { types: Types; data: GraphData; deg: Map<string, number>; byId: Map<string, GraphNode>; concepts: GraphNode[];
  open: (id: string, ids: string[]) => void; beside: (id: string) => void; go: (h: string) => void; typeLabel: (t: string) => string };
const radius = (deg: number, concept?: boolean) => (concept ? 13 : 5) + Math.sqrt(deg) * (concept ? 2.2 : 1.7);
const ago = (iso: string) => (Date.now() - Date.parse(iso.replace(" ", "T") + "Z")) / 864e5;
const edgeKey = (e: GraphEdge) => `e${e.id}`;
const asLink = (e: GraphEdge, fade = 1): Link => ({ key: edgeKey(e), a: e.from, b: e.to, kind: e.kind, origin: e.origin, approved: e.approved, fade });

function Legend({ types }: { types: Types }) {
  return (
    <div className="gx-legend" aria-label="Key">
      {types.types.map((t) => <span key={t.key} style={typeVar(t.key)}><i className="dot" />{t.label}</span>)}
      <span className="sep" />
      <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" className="gx-edge" /></svg>related</span>
      <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" className="gx-edge" strokeDasharray="7 4" /></svg>contradicts</span>
      <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" className="gx-edge" strokeDasharray="1 4" /></svg>inspired by</span>
      <span><svg width="26" height="8"><line x1="0" y1="4" x2="26" y2="4" className="gx-edge" strokeDasharray="2 3" /></svg>mentions</span>
      <span>→ supports, builds on, authored by (arrow points at the other end)</span>
      <span className="sep" />
      <span>✦ added by the Archivist</span><span>✧ AI, approved by you</span>
      <span><svg width="12" height="12" viewBox="0 0 10 12" className="gx-lock"><rect x="1" y="4.5" width="8" height="5.5" rx="1.4" /><path d="M2.8 4.5V3.2a2.2 2.2 0 0 1 4.4 0v1.3" /></svg> Private</span>
    </div>
  );
}

function pickNode(e: React.MouseEvent, id: string, ids: string[], t: Tools) {
  if (e.altKey) t.beside(id);
  else t.open(id, ids);
}

/** A name search that sends you to the graph around the Object you pick. */
function PickObject({ t, placeholder, label }: { t: Tools; placeholder: string; label: string }) {
  const [q, setQ] = useState("");
  const matches = q.length > 1 ? t.data.nodes.filter((n) => n.title.toLowerCase().includes(q.toLowerCase())).slice(0, 7) : [];
  return (
    <label className="gx-pick">{label}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label="Pick the Object to draw around" />
      {matches.length > 0 && <ul>{matches.map((m) => <li key={m.id}><button style={typeVar(m.type)} onClick={() => { setQ(""); t.go(`#/map/${m.id}`); }}><i className="dot" /> {m.title}</button></li>)}</ul>}
    </label>
  );
}

/* ---------- around one Object ---------- */
function AroundOne({ t, focus }: { t: Tools; focus: string }) {
  const [depth, setDepth] = useState(2);
  const adj = useMemo(() => adjacency(t.data.edges), [t]);
  const { ring, total, cut } = useMemo(() => neighbourhood(adj, t.deg, focus, depth), [focus, depth, adj, t]);
  const edges = useMemo(() => t.data.edges.filter((e) => ring.has(e.from) && ring.has(e.to)), [ring, t]);
  const n1 = [...ring.values()].filter((d) => d === 1).length;
  const R = (d: number) => (d === 0 ? 0 : Math.max(150, n1 * 11) + (d - 1) * 200);
  const { sim, reheat } = useSim(`A${focus}-${depth}-${ring.size}`, () => {
    const nodes: SN[] = [...ring].map(([id, d], i) => { const a = (i * 2.399) % (Math.PI * 2); return { id, x: Math.cos(a) * R(d), y: Math.sin(a) * R(d), vx: 0, vy: 0, r: radius(t.deg.get(id) ?? 0, t.byId.get(id)?.type === "concept"), ring: d ? R(d) : undefined, fixed: d === 0 }; });
    nodes.forEach((n) => { if (n.fixed) { n.x = 0; n.y = 0; } });
    const m = new Map(nodes.map((n) => [n.id, n]));
    return new Sim(nodes, edges.map((e) => ({ a: m.get(e.from)!, b: m.get(e.to)!, w: .15, len: 120 })), { charge: 1600, center: .0005 });
  }, false);
  const items: Item[] = [...ring].map(([id, d]) => { const n = t.byId.get(id)!; return { id, label: n.title, type: n.type, r: radius(t.deg.get(id) ?? 0, n.type === "concept") + (d === 0 ? 4 : 0), private: n.private, fade: d <= 1 ? 1 : d === 2 ? .8 : .55, concept: n.type === "concept", rank: d === 0 ? 1e6 : 1000 / (d + 1) + (t.deg.get(id) ?? 0), sub: t.typeLabel(n.type) }; });
  const links = edges.map((e) => asLink(e, (ring.get(e.from)! + ring.get(e.to)!) <= 2 ? 1 : .6));
  const f = t.byId.get(focus)!;
  const ids = [...ring.keys()];
  return (
    <div className="gx gx-a">
      <div className="gx-bar">
        <PickObject t={t} label="Around" placeholder={f.title} />
        <div className="gx-seg" role="group" aria-label="How far out">
          <span className="quiet small">How far out</span>
          {[1, 2, 3].map((d) => <button key={d} className={depth === d ? "on" : ""} onClick={() => setDepth(d)}>{d === 1 ? "Direct" : d === 2 ? "Two steps" : "Three steps"}</button>)}
        </div>
        <span className="quiet small">{ring.size} of {total} Objects{cut ? " (the best-connected are kept, so it stays readable)" : ""} · double-click an Object to draw around it</span>
        <a className="pill action" href={`#/o/${focus}`}>Open {f.title.length > 22 ? f.title.slice(0, 21) + "…" : f.title}</a>
      </div>
      <Canvas sim={sim} items={items} links={links} selected={focus} initialK={.7} noFit edgeLabels={edges.length <= 30 ? "all" : "zoom"} labelBudget={(k) => Math.round(18 + k * 22)} onReheat={reheat}
        under={() => [1, 2, 3].filter((d) => d <= depth).map((d) => <circle key={d} r={R(d)} className="gx-ring" />)}
        onNode={(id, e) => pickNode(e, id, ids, t)} onNodeDouble={(id) => t.go(`#/map/${id}`)} />
      <Legend types={t.types} />
    </div>
  );
}

/* ---------- the whole Garden ---------- */
function WholeMap({ t }: { t: Tools }) {
  const [typeOff, setTypeOff] = useState<Set<string>>(new Set());
  const [concept, setConcept] = useState("");
  const [tag, setTag] = useState("");
  const [when, setWhen] = useState(0);
  const [hideLoose, setHideLoose] = useState(false);
  const allTags = useMemo(() => [...new Set(t.data.nodes.flatMap((n) => n.tags))].sort(), [t]);
  const home = useMemo(() => { const h = conceptHomes(t.data.nodes, t.data.edges, t.deg); return { m: h.home, members: h.members }; }, [t]);
  const match = (n: GraphNode) =>
    !typeOff.has(n.type) && (!concept || n.id === concept || home.members.get(concept)?.has(n.id) === true) && (!tag || n.tags.includes(tag)) && (!when || ago(n.changed) <= when) && !(hideLoose && !(t.deg.get(n.id) ?? 0));
  const ok = new Set(t.data.nodes.filter(match).map((n) => n.id));
  const nodes = t.data.nodes;
  const { sim, reheat } = useSim("B", () => {
    const cs = t.concepts, R = 430;
    const anchor = new Map(cs.map((c, i) => [c.id, { x: Math.cos((i / cs.length) * Math.PI * 2) * R, y: Math.sin((i / cs.length) * Math.PI * 2) * R }]));
    const sn: SN[] = nodes.map((n, i) => {
      const hc = n.type === "concept" ? n.id : home.m.get(n.id); const an = hc ? anchor.get(hc)! : { x: 0, y: 0 };
      const a = (i * 2.399) % (Math.PI * 2);
      return { id: n.id, x: an.x + Math.cos(a) * 60, y: an.y + Math.sin(a) * 60, vx: 0, vy: 0, r: radius(t.deg.get(n.id) ?? 0, n.type === "concept"), ax: hc ? an.x : Math.cos(a) * 560, ay: hc ? an.y : Math.sin(a) * 560, as: hc ? .05 : .02 };
    });
    const m = new Map(sn.map((n) => [n.id, n]));
    return new Sim(sn, t.data.edges.map((e) => { const same = (home.m.get(e.from) ?? e.from) === (home.m.get(e.to) ?? e.to) || home.m.get(e.from) === e.to || home.m.get(e.to) === e.from; return { a: m.get(e.from)!, b: m.get(e.to)!, w: same ? .35 : .03, len: same ? 55 : 200 }; }), { charge: 650, center: .0002 });
  });
  const items: Item[] = nodes.map((n) => ({ id: n.id, label: n.title, type: n.type, r: radius(t.deg.get(n.id) ?? 0, n.type === "concept"), private: n.private, fade: ok.has(n.id) ? 1 : .07, concept: n.type === "concept", rank: (n.type === "concept" ? 1000 : 0) + (t.deg.get(n.id) ?? 0), sub: t.typeLabel(n.type) }));
  const cross = (e: GraphEdge) => (home.m.get(e.from) ?? e.from) !== (home.m.get(e.to) ?? e.to) && home.m.get(e.from) !== e.to && home.m.get(e.to) !== e.from;
  const links = t.data.edges.map((e) => asLink(e, ok.has(e.from) && ok.has(e.to) ? (cross(e) ? .6 : 1) : .05));
  const ids = [...ok];
  const toggle = (k: string) => setTypeOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const filtering = typeOff.size || concept || tag || when || hideLoose;
  return (
    <div className="gx gx-b">
      <aside className="gx-side" aria-label="Filters">
        <h4>Show</h4>
        <div className="gx-chips">{t.types.types.map((ty) => <button key={ty.key} style={typeVar(ty.key)} className={typeOff.has(ty.key) ? "off" : "on"} onClick={() => toggle(ty.key)}><i className="dot" />{ty.plural}</button>)}</div>
        <label>Concept<select value={concept} onChange={(e) => setConcept(e.target.value)}><option value="">Any</option>{t.concepts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <label>Tag<select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Any</option>{allTags.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>Changed<select value={when} onChange={(e) => setWhen(Number(e.target.value))}><option value={0}>Any time</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label>
        <label className="row"><input type="checkbox" checked={hideLoose} onChange={(e) => setHideLoose(e.target.checked)} /> Fade Objects with no Connections</label>
        <p className="quiet small">{ok.size} of {nodes.length} Objects lit{filtering ? "" : " (no filter)"}. Everything else fades but keeps its place, so you never lose your bearings.</p>
        {filtering ? <button className="pill action" onClick={() => { setTypeOff(new Set()); setConcept(""); setTag(""); setWhen(0); setHideLoose(false); }}>Clear filters</button> : null}
        <h4>Concepts</h4>
        <ul className="gx-clist">{t.concepts.map((c) => <li key={c.id}><button style={typeVar("concept")} className={concept === c.id ? "on" : ""} onClick={() => setConcept(concept === c.id ? "" : c.id)}>{c.title} <span className="quiet small">{home.members.get(c.id)?.size ?? 0}</span></button></li>)}</ul>
        <PickObject t={t} label="Draw around" placeholder="an Object's name" />
        <p className="quiet small">Zoom in and more names appear. Point at an Object to see what it touches; double-click one to draw around it. Objects in no Concept sit in the outer ring.</p>
      </aside>
      <div className="gx-main">
        <Canvas sim={sim} items={items} links={links} edgeLabels="zoom" labelBudget={(k) => Math.round(12 + Math.max(0, (k - .5)) * 60)} onReheat={reheat}
          under={(pos) => t.concepts.map((c) => {
            const mem = [c.id, ...t.data.nodes.filter((n) => home.m.get(n.id) === c.id).map((n) => n.id)].map((id) => pos(id)).filter(Boolean) as SN[]; if (mem.length < 3) return null;
            const cx = mem.reduce((a, n) => a + n.x, 0) / mem.length, cy = mem.reduce((a, n) => a + n.y, 0) / mem.length;
            const ds = mem.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b); const r = (ds[Math.floor(ds.length * .92)] ?? 40) + 20;
            return <circle key={c.id} cx={cx} cy={cy} r={r} className="gx-hull" style={{ ...typeVar("concept"), opacity: !concept || concept === c.id ? 1 : .3 }} />;
          })}
          onNode={(id, e) => pickNode(e, id, ids, t)} onNodeDouble={(id) => t.go(`#/map/${id}`)} />
        <Legend types={t.types} />
      </div>
    </div>
  );
}

/* ---------- the page ---------- */
export function MapPage({ types, version, onOpen, go, focus }: { types: Types; version: number; onOpen: (id: string, ids: string[]) => void; go: (h: string) => void; focus?: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  useEffect(() => { fetchGraph().then(setData); }, [version]);
  const lastMain = useRef<string | null>(null);
  const tools = useMemo<Tools | null>(() => {
    if (!data) return null;
    const deg = degrees(data.edges);
    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const concepts = data.nodes.filter((n) => n.type === "concept").sort((a, b) => a.title.localeCompare(b.title));
    return {
      types, data, deg, byId, concepts, go,
      open: (id, ids) => { lastMain.current = id; onOpen(id, ids); },
      // ⌥-click: the second pane opens beside the Object you looked at last (or beside itself, showing its map).
      beside: (id) => { const main = focus ?? lastMain.current ?? id; go(`#/o/${main}/with/${id}`); },
      typeLabel: (k) => types.types.find((x) => x.key === k)?.label ?? k,
    };
  }, [data, types, onOpen, go, focus]);
  return (
    <main className="gx-page">
      <div className="gx-head">
        <h2>Map</h2>
        <nav aria-label="Map views"><a href="#/map" className={focus ? "" : "on"}>Whole Garden</a><a className={focus ? "on" : ""} href={focus ? `#/map/${focus}` : "#/map"} aria-current={focus ? "page" : undefined}>Around one Object</a></nav>
        <span className="quiet small">How everything connects. Nothing here changes your Garden.</span>
      </div>
      {!tools ? <p className="quiet pad">Drawing…</p>
        : !tools.data.nodes.length ? <p className="quiet pad">Nothing in the Garden yet, so there is nothing to draw.</p>
        : focus && tools.byId.has(focus) ? <AroundOne key={focus} t={tools} focus={focus} />
        : focus ? <p className="quiet pad">That Object is not here any more. <a href="#/map">Back to the whole Garden</a></p>
        : <WholeMap t={tools} />}
    </main>
  );
}
