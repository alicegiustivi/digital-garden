// The sums behind the Map (issue #82): how well connected each Object is, what lies within a few steps of one Object,
// and which Concept each Object sits in. Pure functions, no screen, no server.
export type GEdge = { from: string; to: string };
export type GNodeLite = { id: string; type: string };

export function degrees(edges: GEdge[]) {
  const deg = new Map<string, number>();
  for (const e of edges) { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); }
  return deg;
}

export function adjacency(edges: GEdge[]) {
  const adj = new Map<string, string[]>();
  for (const e of edges) { (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to); (adj.get(e.to) ?? adj.set(e.to, []).get(e.to)!).push(e.from); }
  return adj;
}

/**
 * Everything within `depth` steps of `focus`, as Object -> steps away. When more than `cap` Objects lie that close, the
 * best-connected are kept (so the picture stays readable) and `cut` says so; `total` is how many there would have been.
 */
export function neighbourhood(adj: Map<string, string[]>, deg: Map<string, number>, focus: string, depth: number, cap = 130) {
  const reach = new Map<string, number>([[focus, 0]]);
  let frontier = [focus];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const nb of adj.get(id) ?? []) if (!reach.has(nb)) { reach.set(nb, d); next.push(nb); }
    frontier = next;
  }
  const total = reach.size;
  if (total <= cap) return { ring: reach, total, cut: false };
  // Keep the focus, then the nearest, best-connected Objects first.
  const keep = [...reach].sort((a, b) => a[1] - b[1] || (deg.get(b[0]) ?? 0) - (deg.get(a[0]) ?? 0)).slice(0, cap);
  return { ring: new Map(keep), total, cut: true };
}

/** The Concept each Object sits in (the biggest one it is connected straight to), and each Concept's members. */
export function conceptHomes(nodes: GNodeLite[], edges: GEdge[], deg: Map<string, number>) {
  const type = new Map(nodes.map((n) => [n.id, n.type]));
  const home = new Map<string, string>();
  const members = new Map<string, Set<string>>();
  for (const e of edges) {
    const c = type.get(e.from) === "concept" ? e.from : type.get(e.to) === "concept" ? e.to : null;
    if (!c) continue;
    const o = c === e.from ? e.to : e.from;
    if (type.get(o) === "concept") continue;
    (members.get(c) ?? members.set(c, new Set()).get(c)!).add(o);
    const had = home.get(o);
    if (!had || (deg.get(c) ?? 0) > (deg.get(had) ?? 0) || ((deg.get(c) ?? 0) === (deg.get(had) ?? 0) && c < had)) home.set(o, c);
  }
  return { home, members };
}
