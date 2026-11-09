import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

// The Map (issue #82): the one read the graph draws from.
let app: ReturnType<typeof createApp>;
beforeEach(() => { app = createApp(openDb(":memory:").sqlite); });
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title: string, priv = false) => (await call("POST", "/api/objects", { type, title, private: priv })).json;

describe("graph read", () => {
  it("lists live Objects and their Connections, flags Private ones, and leaves out the Bin", async () => {
    const c = await make("concept", "Slow growth"), s = await make("source", "A book"), t = await make("thought", "Quiet", true), gone = await make("source", "Binned");
    await call("POST", "/api/connections", { a: c.id, b: s.id, kind: "related" });
    await call("POST", "/api/connections", { a: t.id, b: s.id, kind: "supports" });
    await call("POST", "/api/connections", { a: gone.id, b: s.id, kind: "related" });
    await call("POST", `/api/objects/${s.id}/tags`, { name: "to read" });
    await call("DELETE", `/api/objects/${gone.id}`);
    const g = (await call("GET", "/api/graph")).json;
    expect(g.nodes.map((n: any) => n.title).sort()).toEqual(["A book", "Quiet", "Slow growth"]);
    expect(g.nodes.find((n: any) => n.title === "Quiet").private).toBe(true);
    expect(g.nodes.find((n: any) => n.title === "A book").tags).toEqual(["to-read"]);
    expect(g.edges).toHaveLength(2);
    expect(g.edges.map((e: any) => e.kind).sort()).toEqual(["related", "supports"]);
    expect(g.edges.every((e: any) => e.origin === "owner")).toBe(true);
  });
});
