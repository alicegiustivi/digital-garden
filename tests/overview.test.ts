import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => { sqlite = openDb(":memory:").sqlite; app = createApp(sqlite); });
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title?: string, priv = false) => (await call("POST", "/api/objects", { type, title, private: priv })).json;
const tag = (o: any, name: string) => call("POST", `/api/objects/${o.id}/tags`, { name });
const link = (a: any, b: any) => call("POST", "/api/connections", { a: a.id, b: b.id });
const overview = async () => (await call("GET", "/api/overview")).json;

describe("Overview", () => {
  it("sizes islands by what is connected straight to them, with the mix, weekly dots and recent items", async () => {
    const big = await make("concept", "Slow growth");
    const small = await make("concept", "Rest");
    const s = await make("source", "A book"); const t = await make("thought", "A thought");
    await link(big, s); await link(big, t); await link(small, s);
    const r = await overview();
    expect(r.islands.map((i: any) => [i.title, i.size])).toEqual([["Slow growth", 2], ["Rest", 1]]);
    expect(r.islands[0].mix).toEqual({ source: 1, thought: 1 });
    expect(r.islands[0].weeks).toHaveLength(8);
    expect(r.islands[0].weeks[7]).toBe(2);
    expect(r.islands[0].recent).toHaveLength(2);
    expect(r.several.map((x: any) => x.title)).toEqual(["A book"]);
    expect(r.several[0].concepts).toHaveLength(2);
    expect(r.dashed).toEqual([]);
  });
  it("puts Objects with no Concept on the shelf, Bin Objects nowhere, Private ones on it (the owner's own view)", async () => {
    const c = await make("concept", "C"); const a = await make("source", "In"); const loose = await make("thought", "Loose"); const secret = await make("thought", "Secret", true);
    const gone = await make("source", "Gone");
    await link(c, a);
    await call("DELETE", `/api/objects/${gone.id}`);
    const r = await overview();
    expect(r.shelf.map((x: any) => x.title).sort()).toEqual(["Loose", "Secret"]);
    expect(r.shelfTotal).toBe(2);
    expect(r.shelf.find((x: any) => x.id === secret.id).private).toBe(true);
    void loose;
  });
  it("shows the biggest Tags as dashed islands only when there are no Concepts", async () => {
    const a = await make("source", "a"); const b = await make("source", "b");
    await tag(a, "memory"); await tag(b, "memory"); await tag(b, "sleep");
    expect((await overview()).dashed.map((t: any) => [t.name, t.count])).toEqual([["memory", 2], ["sleep", 1]]);
    await make("concept", "Now one");
    expect((await overview()).dashed).toEqual([]);
  });
  it("lights up the islands that share a loose Object's Tags", async () => {
    const c1 = await make("concept", "Memory"); const c2 = await make("concept", "Other");
    const inside = await make("source", "inside"); const loose = await make("thought", "loose");
    await link(c1, inside); await tag(inside, "recall"); await tag(loose, "recall");
    const r = (await call("GET", `/api/objects/${loose.id}/light-up`)).json;
    expect(r.tags).toEqual(["recall"]);
    expect(r.islands).toEqual([{ id: c1.id, shared: ["recall"], connected: false }]);
    void c2;
  });
  it("Connect here makes a related Connection with Owner Origin", async () => {
    const c = await make("concept", "C"); const t = await make("thought", "T");
    const r = await call("POST", "/api/connections", { a: t.id, b: c.id });
    expect(r.status).toBe(201);
    const row = sqlite.prepare("SELECT kind, origin FROM connections").get() as any;
    expect(row).toEqual({ kind: "related", origin: "owner" });
  });
});

describe("Turn into Concept", () => {
  it("makes an Owner Concept, connects everything carrying the Tag and removes the Tag by default", async () => {
    const a = await make("source", "a"); const b = await make("thought", "b"); const gone = await make("source", "gone");
    for (const o of [a, b, gone]) await tag(o, "memory");
    await call("DELETE", `/api/objects/${gone.id}`);
    const tagId = (await call("GET", "/api/tags")).json[0].id;
    const r = await call("POST", `/api/tags/${tagId}/concept`, {});
    expect(r.status).toBe(201);
    expect(r.json.connected).toBe(2);
    expect((await call("GET", "/api/tags")).json).toEqual([]);
    const concept = (await call("GET", `/api/objects/${r.json.concept.id}`)).json;
    expect(concept.type).toBe("concept");
    expect(concept.unreviewed).toBe(false);
    expect(concept.fields.find((f: any) => f.key === "title")).toMatchObject({ value: "memory", origin: "owner" });
    const cons = sqlite.prepare("SELECT kind, origin FROM connections").all() as any[];
    expect(cons).toEqual([{ kind: "related", origin: "owner" }, { kind: "related", origin: "owner" }]);
  });
  it("can keep the Tag, and Undo puts everything back as it was", async () => {
    const a = await make("source", "a"); await tag(a, "memory");
    const tagId = (await call("GET", "/api/tags")).json[0].id;
    const kept = await call("POST", `/api/tags/${tagId}/concept`, { removeTag: false });
    expect((await call("GET", "/api/tags")).json).toHaveLength(1);
    await call("POST", "/api/concepts/undo", { conceptId: kept.json.concept.id, removed: kept.json.removed });
    expect((await overview()).islands).toEqual([]);
    const again = await call("POST", `/api/tags/${tagId}/concept`, {});
    await call("POST", "/api/concepts/undo", { conceptId: again.json.concept.id, removed: again.json.removed });
    expect((await call("GET", "/api/tags")).json).toMatchObject([{ name: "memory", count: 1 }]);
    expect((await overview()).islands).toEqual([]);
    expect((sqlite.prepare("SELECT count(*) AS n FROM connections").get() as any).n).toBe(0);
  });
  it("404s for a Tag that does not exist", async () => {
    expect((await call("POST", "/api/tags/999/concept", {})).status).toBe(404);
  });
});
