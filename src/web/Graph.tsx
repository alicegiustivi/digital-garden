// The Map (issues #82, redesign): the whole Garden drawn as one calm graph, clustered by Concept, and a full-size graph around
// one Object with a "how far out" control. Quiet by default (small dots, hairline lines, only Concept names), and it speaks up
// where you point: the Object you touch and what it connects to light up, with the kind of each Connection written on it.
// Read-only: nothing here changes the Garden. All drawing and layout is local; no AI. The owner's own view, so Private
// Objects are drawn (with a lock) and Objects in the Bin are not.
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchGraph, type GraphData, type GraphEdge, type GraphNode, type Types } from "./api";
import { adjacency, conceptHomes, degrees, neighbourhood } from "./graph-math";
import { Icon, typeVar } from "./ui";

/* ---------- a tiny force layout (no library) ---------- */
type SN = { i?: number; id: string; x: number; y: number; vx: number; vy: number; r: number; fixed?: boolean; ax?: number; ay?: number; as?: number; ring?: number };
type SL = { a: SN; b: SN; w: number; len: number };
const lastPos = new Map<string, { x: number; y: number }>();
class Sim {
  alpha = 1;
  constructor(public nodes: SN[], public links: SL[], public o: { charge: number; center: number }) {}
  step() {
    const { nodes, links, o } = this, n = nodes.length;
    // Repulsion only between nearby dots (a grid of cells as wide as the reach), so a big Garden settles quickly.
    const CUT = 170, cells = new Map<number, SN[]>();
    nodes.forEach((p, i) => { p.i = i; const k = Math.floor(p.x / CUT) * 100003 + Math.floor(p.y / CUT); (cells.get(k) ?? cells.set(k, []).get(k)!).push(p); });
    for (let i = 0; i < n; i++) {
      const a = nodes[i], cx = Math.floor(a.x / CUT), cy = Math.floor(a.y / CUT);
      for (let gx = -1; gx <= 1; gx++) for (let gy = -1; gy <= 1; gy++) {
        const cell = cells.get((cx + gx) * 100003 + cy + gy); if (!cell) continue;
        for (const b of cell) {
          if (b.i! <= i) continue;
          let dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 > CUT * CUT) continue; if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; }
          const d = Math.sqrt(d2), minD = a.r + b.r + 6, f = (o.charge / Math.max(d2, 150)) + (d < minD ? (minD - d) * .2 : 0);
          const fx = (dx / d) * f, fy = (dy / d) * f; a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
        }
      }
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
  const sim = useMemo(() => { const s = build(); for (const nn of remember ? s.nodes : []) { const p = lastPos.get(nn.id); if (p) { nn.x = p.x; nn.y = p.y; s.alpha = Math.min(s.alpha, .5); } } if (s.nodes.length > 250) { for (let i = 0; i < 240; i++) s.step(); s.alpha = .02; } else for (let i = 0; i < 60; i++) s.step(); // a big Garden is laid out at once; a small one settles in view
    simRef.current = s; return s; }, [key]); // eslint-disable-line
  useEffect(() => {
    const loop = () => { for (let i = 0; i < 2; i++) sim.step(); if (remember) for (const nn of sim.nodes) lastPos.set(nn.id, { x: nn.x, y: nn.y }); setTick((t) => t + 1); if (sim.alpha > .02) raf.current = requestAnimationFrame(loop); };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [sim]);
  const reheat = () => { sim.alpha = Math.max(sim.alpha, .5); cancelAnimationFrame(raf.current); const loop = () => { for (let i = 0; i < 2; i++) sim.step(); setTick((t) => t + 1); if (sim.alpha > .02) raf.current = requestAnimationFrame(loop); }; raf.current = requestAnimationFrame(loop); };
  return { sim, reheat };
}

/* ---------- the drawing surface (zoom, pan, drag, labels, floating controls) ---------- */
export type Item = { id: string; label: string; type: string; r: number; private?: boolean; fade: number; concept?: boolean; rank: number; sub?: string; meta?: string };
export type Link = { key: string; a: string; b: string; kind: string; origin: string; approved: boolean; fade: number; note?: string };
const DASH: Record<string, string | undefined> = { related: undefined, supports: undefined, "builds on": undefined, "inspired by": "1 4", contradicts: "7 4", mentions: "2 3", "authored by": "10 3 2 3", "part of": undefined };
const DIRECTED = new Set(["supports", "builds on", "inspired by", "authored by", "mentions", "part of"]);

function Canvas({ sim, items, links, under, onNode, onNodeDouble, selected, labelBudget, onReheat, initialK = 1, noFit, flyTo, topLeft, topRight, count, lightSelected = true, edgeText }: {
  sim: Sim; items: Item[]; links: Link[]; under?: (pos: (id: string) => SN | undefined) => React.ReactNode; onNode: (id: string, e: React.MouseEvent) => void; onNodeDouble?: (id: string) => void;
  selected?: string | null; labelBudget: (k: number) => number; onReheat: () => void; initialK?: number; noFit?: boolean; flyTo?: { id: string; n: number };
  topLeft?: React.ReactNode; topRight?: React.ReactNode; count?: number;
  /** Does the selected Object light up what it touches (the Map), or only get a ring (the graph around it, where it is the centre anyway)? */
  lightSelected?: boolean;
  /** Write the kind of every Connection on its line (for a small graph). */
  edgeText?: boolean;
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
  const focusId = hover ?? (lightSelected ? selected : null) ?? null;
  const lit = focusId ? new Set([focusId, ...(nbrs.get(focusId) ?? [])]) : null;
  const toWorld = (cx: number, cy: number) => { const r = box.current!.getBoundingClientRect(); return { x: (cx - r.left - size.w / 2 - view.x) / view.k, y: (cy - r.top - size.h / 2 - view.y) / view.k }; };
  const zoomTo = (k: number, px = 0, py = 0) => { k = Math.min(6, Math.max(.15, k)); setView((v) => ({ k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k })); };
  const onWheel = (e: React.WheelEvent) => { const r = box.current!.getBoundingClientRect(); zoomTo(view.k * Math.exp(-e.deltaY * .0015), e.clientX - r.left - size.w / 2, e.clientY - r.top - size.h / 2); };
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
  // Names: Concepts first, then the best-connected, as many as the zoom allows; a name is skipped if it would sit on another.
  const ranked = useMemo(() => [...items].sort((a, b) => b.rank - a.rank), [items]);
  const budget = labelBudget(view.k);
  const labelled = new Set<string>();
  { const boxes: [number, number, number, number][] = [];
    // Pointing at an Object: its name first, then the names of what it touches. Otherwise the biggest names the zoom allows.
    const order = focusId && lit ? [...ranked.filter((i) => i.id === focusId), ...ranked.filter((i) => i.id !== focusId && lit.has(i.id))] : ranked;
    const cap = lit ? 40 : budget;
    for (const i of order) {
      if (labelled.size >= cap) break; if (i.fade <= .5) continue;
      const n = byId.get(i.id); if (!n) continue;
      const w = Math.min(i.label.length, 34) * (i.concept ? 7.4 : 6.2) + 8, x = size.w / 2 + view.x + n.x * view.k, y = size.h / 2 + view.y + n.y * view.k + i.r * view.k + 3;
      if (x < -w || x > size.w + w || y < -20 || y > size.h + 20) continue;
      const b: [number, number, number, number] = [x - w / 2, y, x + w / 2, y + 15];
      const must = i.id === focusId || (i.concept && !lit);
      if (!must && boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) continue;
      boxes.push(b); labelled.add(i.id);
    } }
  const s = 1 / view.k;
  const fitAll = (only?: Set<string>) => {
    const ns = sim.nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && (!only || only.has(n.id))); if (!ns.length || size.h < 50) return false;
    const mx = ns.reduce((a, n) => a + n.x, 0) / ns.length, my = ns.reduce((a, n) => a + n.y, 0) / ns.length;
    const ds = ns.map((n) => Math.hypot(n.x - mx, n.y - my)).sort((a, b) => a - b); const lim = only ? Math.max(120, (ds[Math.floor(ds.length / 2)] ?? 0) * 2.6) : Infinity;
    const kept = ns.filter((n) => Math.hypot(n.x - mx, n.y - my) <= lim); const xs = kept.map((n) => n.x), ys = kept.map((n) => n.y);
    const w = Math.max(...xs) - Math.min(...xs) + 150, h = Math.max(...ys) - Math.min(...ys) + 150, k = Math.min(size.w / w, size.h / h, 2);
    setView({ k, x: -((Math.max(...xs) + Math.min(...xs)) / 2) * k, y: -((Math.max(...ys) + Math.min(...ys)) / 2) * k }); return true;
  };
  // When a search or filter lights only some Objects, zoom to them; when it is cleared, show everything again.
  const litKey = items.filter((i) => i.fade > .5).map((i) => i.id).join(",");
  const lastLit = useRef(litKey);
  useEffect(() => { if (lastLit.current === litKey || noFit) return; lastLit.current = litKey; const l = new Set(items.filter((i) => i.fade > .5).map((i) => i.id)); const t = setTimeout(() => fitAll(l.size && l.size < items.length ? l : undefined), 700); return () => clearTimeout(t); }); // eslint-disable-line
  const fits = useRef(0);
  const lastSim = useRef(sim);
  if (lastSim.current !== sim) { lastSim.current = sim; fits.current = 0; }
  // Fit the whole picture once it is drawn, again as it settles, and a last time when it has stopped moving.
  const fitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (size.h < 50 || noFit) return;
    if (fits.current === 0 || (fits.current === 1 && sim.alpha < .1)) { fitAll(); fits.current++; }
    if (fits.current < 3) { clearTimeout(fitTimer.current); fitTimer.current = setTimeout(() => { if (sim.alpha <= .021) { fitAll(); fits.current = 3; } }, 300); }
  });
  useEffect(() => () => clearTimeout(fitTimer.current), []);
  // Picking an Object in the search flies to it.
  useEffect(() => { if (!flyTo) return; const n = byId.get(flyTo.id); if (!n) return; const k = Math.max(view.k, 1.4); setView({ k, x: -n.x * k, y: -n.y * k }); }, [flyTo?.n]); // eslint-disable-line
  const zoomed = view.k > 1.6;
  const fi = focusId ? itemById.get(focusId) : undefined;
  return (
    <div className="gx-canvas" ref={box} onWheel={onWheel}>
      <svg width={size.w} height={size.h} onPointerDown={(e) => down(e)} onPointerMove={move} onPointerUp={(e) => up(e)} onPointerLeave={() => (drag.current = null)} role="img" aria-label="Graph of how the Objects in the Garden connect">
        <defs>
          <marker id="gx-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 1 L10 5 L0 9 z" fill="context-stroke" /></marker>
        </defs>
        <g transform={`translate(${size.w / 2 + view.x} ${size.h / 2 + view.y}) scale(${view.k})`}>
          {under?.((id) => byId.get(id))}
          {links.map((l) => {
            const a = byId.get(l.a), b = byId.get(l.b); if (!a || !b) return null;
            const hot = !!lit && (l.a === focusId || l.b === focusId);
            const op = (lit ? (hot ? 1 : .04) : l.fade >= 1 ? .4 : l.fade >= .5 ? .09 : .03);
            const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
            const ra = (itemById.get(l.a)?.r ?? 4) + 1, rb = (itemById.get(l.b)?.r ?? 4) + (hot || zoomed ? 3 : 1);
            const x1 = a.x + (dx / d) * ra, y1 = a.y + (dy / d) * ra, x2 = b.x - (dx / d) * rb, y2 = b.y - (dy / d) * rb, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            const ai = l.origin === "ai";
            const label = (hot || !!edgeText) && l.fade > .5;
            // On a small graph the kind is written nearer the outer end, so the names do not pile up in the middle.
            const far = Math.hypot(a.x, a.y) > Math.hypot(b.x, b.y) ? 0.35 : 0.65, tx = hot || !edgeText ? mx : a.x + dx * far, ty = hot || !edgeText ? my : a.y + dy * far;
            return (
              <g key={l.key} opacity={op}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} className={`gx-edge k-${l.kind.replace(" ", "-")} ${hot ? "hot" : ""}`} strokeDasharray={DASH[l.kind]} vectorEffect="non-scaling-stroke" markerEnd={DIRECTED.has(l.kind) && (hot || zoomed) ? "url(#gx-arrow)" : undefined} />
                {(label || (ai && zoomed && l.fade > .5)) && (
                  <text x={tx} y={ty} className="gx-elabel" fontSize={10.5 * s} textAnchor="middle" dy={3 * s}>
                    <tspan className="gx-halo">{label ? l.kind : ""}{ai ? (label ? " " : "") + (l.approved ? "✧" : "✦") : ""}</tspan>
                  </text>
                )}
                {l.note && label && <title>{l.note}</title>}
              </g>
            );
          })}
          {items.map((it) => {
            const n = byId.get(it.id); if (!n) return null;
            const dim = lit ? (lit.has(it.id) ? 1 : .14) : 1; const op = Math.min(dim, it.fade);
            const rr = Math.max(it.r, (it.concept ? 6 : 3) * s); // never smaller than a readable dot, however far out you are
            const show = labelled.has(it.id);
            return (
              <g key={it.id} transform={`translate(${n.x} ${n.y})`} opacity={op} style={{ ...typeVar(it.type), cursor: "pointer" }}
                onPointerDown={(e) => down(e, it.id)} onPointerUp={(e) => up(e, it.id)} onPointerEnter={() => setHover(it.id)} onPointerLeave={() => setHover(null)} onDoubleClick={() => onNodeDouble?.(it.id)}>
                <circle r={rr + 6 * s} className="gx-hit" />
                {it.id === selected && <circle r={rr + 4 * s} className="gx-sel" />}
                <circle r={rr} className={`gx-node ${it.concept ? "concept" : ""}`} />
                {it.private && (view.k > 1.3 || it.id === focusId) && <g transform={`translate(${rr * .75} ${-rr * .75 - 5 * s}) scale(${s * 1.05})`} className="gx-lock"><rect x="-4.5" y="-1.5" width="9" height="6.5" rx="1.6" /><path d="M-2.6 -1.5V-3a2.6 2.6 0 0 1 5.2 0v1.5" /></g>}
                {show && (
                  <text y={rr + 12 * s} textAnchor="middle" fontSize={(it.concept ? 12.5 : 11) * s} className={`gx-label ${it.concept ? "concept" : ""}`}>
                    <tspan className="gx-halo">{it.label.length > 34 ? it.label.slice(0, 33) + "…" : it.label}</tspan>
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="gx-tl">{topLeft}</div>
      <div className="gx-tr">{count !== undefined && <span className="gx-count" title="Objects shown">{count}</span>}{topRight}</div>
      <div className="gx-zoom" role="group" aria-label="Zoom">
        <button onClick={() => zoomTo(view.k / 1.4)} aria-label="Zoom out">−</button>
        <span className="gx-pct">{Math.round(view.k * 100)}%</span>
        <button onClick={() => zoomTo(view.k * 1.4)} aria-label="Zoom in">+</button>
        <span className="gx-zsep" />
        <button onClick={() => fitAll()} aria-label="Fit everything" className="gx-fit">Fit</button>
      </div>
      {fi && (
        <div className="gx-hover" style={typeVar(fi.type)}>
          <i className="dot" /><b>{fi.label}</b>
          <span className="quiet small">{[fi.sub, fi.meta].filter(Boolean).join(" · ")}</span>
          <span className="quiet small gx-hint">click: peek · double-click: draw around · ⌥-click: second pane</span>
        </div>
      )}
    </div>
  );
}

/* ---------- shared bits ---------- */
type Tools = { types: Types; data: GraphData; deg: Map<string, number>; byId: Map<string, GraphNode>; concepts: GraphNode[];
  open: (id: string, ids: string[]) => void; beside: (id: string) => void; go: (h: string) => void; typeLabel: (t: string) => string; lastOpened: () => string | null };
// Dots stay small so a big Garden reads as a field, not a wall; the best-connected grow a little, Concepts more.
const radius = (deg: number, concept?: boolean) => (concept ? 8 + Math.sqrt(deg) * 1.5 : 3.4 + Math.min(6, Math.sqrt(deg) * .9));
const ago = (iso: string) => (Date.now() - Date.parse(iso.replace(" ", "T") + "Z")) / 864e5;
const edgeKey = (e: GraphEdge) => `e${e.id}`;
const asLink = (e: GraphEdge, fade = 1): Link => ({ key: edgeKey(e), a: e.from, b: e.to, kind: e.kind, origin: e.origin, approved: e.approved, fade });
const metaOf = (t: Tools, id: string) => { const n = t.deg.get(id) ?? 0; return `${n} ${n === 1 ? "Connection" : "Connections"}${t.byId.get(id)?.private ? " · Private" : ""}`; };

/** A floating button that opens a small panel under it and closes on Esc or a click outside. */
function Pop({ label, icon, badge, children, align = "right" }: { label: string; icon?: string; badge?: number; children: React.ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="gx-pop" ref={ref}>
      <button className={`gx-btn ${open ? "on" : ""}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>{icon && <Icon name={icon} />}{label}{!!badge && <span className="gx-badge">{badge}</span>}</button>
      {open && <div className={`gx-panel ${align}`} role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

function KeyPanel({ types }: { types: Types }) {
  const line = (dash?: string) => <svg width="30" height="8" aria-hidden="true"><line x1="0" y1="4" x2="30" y2="4" className="gx-edge hot" strokeDasharray={dash} /></svg>;
  return (
    <div className="gx-key">
      <h4>Colour</h4>
      {types.types.map((t) => <p key={t.key} style={typeVar(t.key)}><i className="dot" />{t.label}</p>)}
      <h4>Lines</h4>
      <p>{line()}related</p><p><svg width="30" height="8" aria-hidden="true"><line x1="0" y1="4" x2="30" y2="4" className="gx-edge hot k-part-of" /></svg>part of</p><p>{line("7 4")}contradicts</p><p>{line("1 4")}inspired by</p><p>{line("2 3")}mentions</p>
      <p className="quiet small">Arrows (supports, builds on, authored by, part of) point at the other end and show as you point at an Object.</p>
      <h4>Marks</h4>
      <p>✦ added by the Archivist</p><p>✧ AI, approved by you</p>
      <p><svg width="12" height="12" viewBox="-6 -6 12 12" className="gx-lock keyl"><rect x="-4.5" y="-1.5" width="9" height="6.5" rx="1.6" /><path d="M-2.6 -1.5V-3a2.6 2.6 0 0 1 5.2 0v1.5" /></svg> Private</p>
      <h4>How it works</h4>
      <p className="quiet small">Point at an Object to light up what it connects to. Click opens it in a peek; double-click draws the graph around it; ⌥-click puts it in the second pane. Scroll to zoom, drag to move. Zoom in and more names appear.</p>
    </div>
  );
}

function pickNode(e: React.MouseEvent, id: string, ids: string[], t: Tools) {
  if (e.altKey) t.beside(id);
  else t.open(id, ids);
}

/** The search box: typing lights what matches (via onQuery) and lists a few; picking one calls onPick. */
function SearchBox({ t, placeholder, onQuery, onPick }: { t: Tools; placeholder: string; onQuery?: (q: string) => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const needle = q.trim().toLowerCase();
  const matches = useMemo(() => needle.length < 1 ? [] : t.data.nodes.filter((n) => n.title.toLowerCase().includes(needle)).sort((a, b) => Number(b.title.toLowerCase().startsWith(needle)) - Number(a.title.toLowerCase().startsWith(needle)) || (t.deg.get(b.id) ?? 0) - (t.deg.get(a.id) ?? 0)).slice(0, 7), [needle, t]);
  const set = (v: string) => { setQ(v); setOpen(true); onQuery?.(v.trim().toLowerCase()); };
  const pick = (id: string) => { onPick(id); setOpen(false); };
  return (
    <div className="gx-search">
      <Icon name="search" />
      <input value={q} onChange={(e) => set(e.target.value)} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder} aria-label={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) pick(matches[0].id); if (e.key === "Escape") { set(""); (e.target as HTMLInputElement).blur(); } }} />
      {q && <button className="gx-x" onClick={() => set("")} aria-label="Clear search"><Icon name="close" /></button>}
      {open && matches.length > 0 && <ul>{matches.map((m) => <li key={m.id}><button style={typeVar(m.type)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m.id)}><i className="dot" /><span>{m.title}</span><span className="quiet small">{t.typeLabel(m.type)}</span></button></li>)}</ul>}
    </div>
  );
}

function ModeSwitch({ t, focus }: { t: Tools; focus?: string }) {
  const target = () => t.lastOpened() ?? [...t.concepts].sort((a, b) => (t.deg.get(b.id) ?? 0) - (t.deg.get(a.id) ?? 0))[0]?.id ?? t.data.nodes[0]?.id;
  return (
    <div className="gx-seg" role="group" aria-label="Map view">
      <button className={focus ? "" : "on"} onClick={() => t.go("#/map")}>Whole Garden</button>
      <button className={focus ? "on" : ""} onClick={() => !focus && t.go(`#/map/${target()}`)}>Around one</button>
    </div>
  );
}

/* ---------- around one Object ---------- */
function AroundOne({ t, focus }: { t: Tools; focus: string }) {
  const [depth, setDepth] = useState(2);
  const adj = useMemo(() => adjacency(t.data.edges), [t]);
  const { ring } = useMemo(() => neighbourhood(adj, t.deg, focus, depth), [focus, depth, adj, t]);
  const edges = useMemo(() => t.data.edges.filter((e) => ring.has(e.from) && ring.has(e.to)), [ring, t]);
  const n1 = [...ring.values()].filter((d) => d === 1).length;
  const R = (d: number) => (d === 0 ? 0 : Math.max(150, n1 * 11) + (d - 1) * 200);
  const { sim, reheat } = useSim(`A${focus}-${depth}-${ring.size}`, () => {
    const nodes: SN[] = [...ring].map(([id, d], i) => { const a = (i * 2.399) % (Math.PI * 2); return { id, x: Math.cos(a) * R(d), y: Math.sin(a) * R(d), vx: 0, vy: 0, r: radius(t.deg.get(id) ?? 0, t.byId.get(id)?.type === "concept") + (d === 0 ? 3 : 0), ring: d ? R(d) : undefined, fixed: d === 0 }; });
    nodes.forEach((n) => { if (n.fixed) { n.x = 0; n.y = 0; } });
    const m = new Map(nodes.map((n) => [n.id, n]));
    return new Sim(nodes, edges.map((e) => ({ a: m.get(e.from)!, b: m.get(e.to)!, w: .15, len: 120 })), { charge: 1600, center: .0005 });
  }, false);
  const items: Item[] = [...ring].map(([id, d]) => { const n = t.byId.get(id)!; return { id, label: n.title, type: n.type, r: radius(t.deg.get(id) ?? 0, n.type === "concept") + (d === 0 ? 3 : 0), private: n.private, fade: d <= 1 ? 1 : d === 2 ? .8 : .6, concept: n.type === "concept", rank: d === 0 ? 1e6 : 1000 / (d + 1) + (t.deg.get(id) ?? 0), sub: t.typeLabel(n.type), meta: metaOf(t, id) }; });
  const links = edges.map((e) => asLink(e, (ring.get(e.from)! + ring.get(e.to)!) <= 2 ? 1 : .6));
  const f = t.byId.get(focus)!;
  const ids = [...ring.keys()];
  return (
    <Canvas sim={sim} items={items} links={links} selected={focus} lightSelected={false} edgeText={edges.length <= 40} initialK={.7} noFit labelBudget={(k) => Math.round(14 + k * 20)} onReheat={reheat} count={ring.size}
      under={() => [1, 2, 3].filter((d) => d <= depth).map((d) => <circle key={d} r={R(d)} className="gx-ring" />)}
      topLeft={<SearchBox t={t} placeholder={`Around ${f.title.length > 26 ? f.title.slice(0, 25) + "…" : f.title} — pick another…`} onPick={(id) => t.go(`#/map/${id}`)} />}
      topRight={<>
        <div className="gx-seg" role="group" aria-label="How far out">{[1, 2, 3].map((d) => <button key={d} className={depth === d ? "on" : ""} onClick={() => setDepth(d)} title={d === 1 ? "Only what it is connected to" : `Up to ${d} steps out`}>{d === 1 ? "Direct" : `${d} steps`}</button>)}</div>
        <a className="gx-btn" href={`#/o/${focus}`}>Open</a>
        <Pop label="Key"><KeyPanel types={t.types} /></Pop>
        <ModeSwitch t={t} focus={focus} />
      </>}
      onNode={(id, e) => pickNode(e, id, ids, t)} onNodeDouble={(id) => t.go(`#/map/${id}`)} />
  );
}

/* ---------- the whole Garden ---------- */
function WholeMap({ t }: { t: Tools }) {
  const [typeOff, setTypeOff] = useState<Set<string>>(new Set());
  const [concept, setConcept] = useState("");
  const [tag, setTag] = useState("");
  const [when, setWhen] = useState(0);
  const [hideLoose, setHideLoose] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [fly, setFly] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const allTags = useMemo(() => [...new Set(t.data.nodes.flatMap((n) => n.tags))].sort(), [t]);
  const home = useMemo(() => { const h = conceptHomes(t.data.nodes, t.data.edges, t.deg); return { m: h.home, members: h.members }; }, [t]);
  const match = (n: GraphNode) =>
    !typeOff.has(n.type) && (!concept || n.id === concept || home.members.get(concept)?.has(n.id) === true) && (!tag || n.tags.includes(tag)) && (!when || ago(n.changed) <= when) && !(hideLoose && !(t.deg.get(n.id) ?? 0))
    && (!query || n.title.toLowerCase().includes(query));
  const ok = new Set(t.data.nodes.filter(match).map((n) => n.id));
  const nodes = t.data.nodes;
  const { sim, reheat } = useSim("B", () => {
    const cs = t.concepts, R = 340;
    const anchor = new Map(cs.map((c, i) => [c.id, { x: Math.cos((i / cs.length) * Math.PI * 2) * R, y: Math.sin((i / cs.length) * Math.PI * 2) * R }]));
    const sn: SN[] = nodes.map((n, i) => {
      const hc = n.type === "concept" ? n.id : home.m.get(n.id); const an = hc ? anchor.get(hc)! : { x: 0, y: 0 };
      const a = (i * 2.399) % (Math.PI * 2);
      return { id: n.id, x: an.x + Math.cos(a) * 60, y: an.y + Math.sin(a) * 60, vx: 0, vy: 0, r: radius(t.deg.get(n.id) ?? 0, n.type === "concept"), ax: hc ? an.x : Math.cos(a) * 470, ay: hc ? an.y : Math.sin(a) * 470, as: hc ? .05 : .02 };
    });
    const m = new Map(sn.map((n) => [n.id, n]));
    return new Sim(sn, t.data.edges.map((e) => { const same = (home.m.get(e.from) ?? e.from) === (home.m.get(e.to) ?? e.to) || home.m.get(e.from) === e.to || home.m.get(e.to) === e.from; return { a: m.get(e.from)!, b: m.get(e.to)!, w: same ? .35 : .03, len: same ? 40 : 200 }; }), { charge: 420, center: .0002 });
  });
  const items: Item[] = nodes.map((n) => ({ id: n.id, label: n.title, type: n.type, r: radius(t.deg.get(n.id) ?? 0, n.type === "concept"), private: n.private, fade: ok.has(n.id) ? 1 : .08, concept: n.type === "concept", rank: (n.type === "concept" ? 1000 : 0) + (t.deg.get(n.id) ?? 0), sub: t.typeLabel(n.type), meta: metaOf(t, n.id) }));
  const cross = (e: GraphEdge) => (home.m.get(e.from) ?? e.from) !== (home.m.get(e.to) ?? e.to) && home.m.get(e.from) !== e.to && home.m.get(e.to) !== e.from;
  const links = t.data.edges.map((e) => asLink(e, ok.has(e.from) && ok.has(e.to) ? (cross(e) ? .6 : 1) : .05));
  const ids = [...ok];
  const toggle = (k: string) => setTypeOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const active = (typeOff.size ? 1 : 0) + (concept ? 1 : 0) + (tag ? 1 : 0) + (when ? 1 : 0) + (hideLoose ? 1 : 0);
  const conceptCount = t.concepts.length;
  return (
    <Canvas sim={sim} items={items} links={links} selected={picked} labelBudget={(k) => Math.round(conceptCount + Math.max(0, k - .85) * 45)} onReheat={reheat} count={ok.size}
      flyTo={fly}
      topLeft={<SearchBox t={t} placeholder="Search the Garden…" onQuery={(q) => { setQuery(q); if (!q) setPicked(null); }} onPick={(id) => { setPicked(id); setFly((f) => ({ id, n: f.n + 1 })); }} />}
      topRight={<>
        <Pop label="Filters" icon="filter" badge={active}>
          <div className="gx-filters">
            <h4>Show</h4>
            <div className="gx-chips">{t.types.types.map((ty) => <button key={ty.key} style={typeVar(ty.key)} className={typeOff.has(ty.key) ? "off" : "on"} onClick={() => toggle(ty.key)}><i className="dot" />{ty.plural}</button>)}</div>
            <label>Concept<select value={concept} onChange={(e) => setConcept(e.target.value)}><option value="">Any</option>{t.concepts.map((c) => <option key={c.id} value={c.id}>{c.title} ({home.members.get(c.id)?.size ?? 0})</option>)}</select></label>
            <label>Tag<select value={tag} onChange={(e) => setTag(e.target.value)}><option value="">Any</option>{allTags.map((x) => <option key={x}>{x}</option>)}</select></label>
            <label>Changed<select value={when} onChange={(e) => setWhen(Number(e.target.value))}><option value={0}>Any time</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></label>
            <label className="row"><input type="checkbox" checked={hideLoose} onChange={(e) => setHideLoose(e.target.checked)} /> Fade Objects with no Connections</label>
            <p className="quiet small">Anything that doesn't match fades but keeps its place, so you never lose your bearings.</p>
            {active > 0 && <button className="gx-btn" onClick={() => { setTypeOff(new Set()); setConcept(""); setTag(""); setWhen(0); setHideLoose(false); }}>Clear filters</button>}
          </div>
        </Pop>
        <Pop label="Key"><KeyPanel types={t.types} /></Pop>
        <ModeSwitch t={t} />
      </>}
      under={(pos) => t.concepts.map((c) => {
        const mem = [c.id, ...t.data.nodes.filter((n) => home.m.get(n.id) === c.id).map((n) => n.id)].map((id) => pos(id)).filter(Boolean) as SN[]; if (mem.length < 3) return null;
        const cx = mem.reduce((a, n) => a + n.x, 0) / mem.length, cy = mem.reduce((a, n) => a + n.y, 0) / mem.length;
        const ds = mem.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b); const r = (ds[Math.floor(ds.length * .92)] ?? 40) + 18;
        return <circle key={c.id} cx={cx} cy={cy} r={r} className="gx-hull" style={{ ...typeVar("concept"), opacity: !concept || concept === c.id ? 1 : .3 }} />;
      })}
      onNode={(id, e) => pickNode(e, id, ids, t)} onNodeDouble={(id) => t.go(`#/map/${id}`)} />
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
      lastOpened: () => (lastMain.current && byId.has(lastMain.current) ? lastMain.current : null),
      typeLabel: (k) => types.types.find((x) => x.key === k)?.label ?? k,
    };
  }, [data, types, onOpen, go, focus]);
  return (
    <main className="gx-page">
      {!tools ? <p className="quiet pad">Drawing…</p>
        : !tools.data.nodes.length ? <p className="quiet pad">Nothing in the Garden yet, so there is nothing to draw.</p>
        : focus && tools.byId.has(focus) ? <AroundOne key={focus} t={tools} focus={focus} />
        : focus ? <p className="quiet pad">That Object is not here any more. <a href="#/map">Back to the whole Garden</a></p>
        : <WholeMap t={tools} />}
    </main>
  );
}
