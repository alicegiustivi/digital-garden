import { describe, it, expect } from "vitest";
import { adjacency, conceptHomes, degrees, neighbourhood } from "../src/web/graph-math.ts";

const e = (from: string, to: string) => ({ from, to });
// c1 — a — b — d — x ; c1 — b ; c2 — b
const edges = [e("c1", "a"), e("a", "b"), e("b", "d"), e("d", "x"), e("c1", "b"), e("c2", "b")];
const deg = degrees(edges);

describe("Map sums", () => {
  it("counts Connections per Object", () => { expect(deg.get("b")).toBe(4); expect(deg.get("x")).toBe(1); });
  it("reaches as far out as asked, naming each step", () => {
    const adj = adjacency(edges);
    expect([...neighbourhood(adj, deg, "d", 1).ring]).toEqual([["d", 0], ["b", 1], ["x", 1]]);
    const two = neighbourhood(adj, deg, "d", 2);
    expect(two.ring.get("a")).toBe(2); expect(two.ring.get("c1")).toBe(2); expect(two.cut).toBe(false);
  });
  it("keeps the nearest, best-connected when there are too many, and says so", () => {
    const adj = adjacency(edges);
    const r = neighbourhood(adj, deg, "b", 3, 3);
    expect(r.cut).toBe(true); expect(r.total).toBe(6); expect(r.ring.size).toBe(3); expect(r.ring.has("b")).toBe(true);
    expect(r.ring.has("c2")).toBe(false); expect(r.ring.has("x")).toBe(false); // the worse connected and the farther go first
  });
  it("puts an Object in the biggest Concept it is connected to", () => {
    const nodes = [{ id: "c1", type: "concept" }, { id: "c2", type: "concept" }, { id: "a", type: "source" }, { id: "b", type: "thought" }, { id: "d", type: "source" }, { id: "x", type: "person" }];
    const { home, members } = conceptHomes(nodes, edges, deg);
    expect(home.get("b")).toBe("c1"); // c1 has 2 Connections, c2 has 1
    expect(home.get("a")).toBe("c1");
    expect(home.has("d")).toBe(false);
    expect([...(members.get("c2") ?? [])]).toEqual(["b"]);
  });
});
