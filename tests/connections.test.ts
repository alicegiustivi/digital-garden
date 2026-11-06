import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  app = createApp(sqlite);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title?: string, priv = false) => (await call("POST", "/api/objects", { type, title, private: priv })).json;
const tok = (o: any) => `[[o:${o.id}]]`;
const body = (o: any, ...p: string[]) => call("PUT", `/api/objects/${o.id}/body`, { paragraphs: p });
const conns = async (o: any) => (await call("GET", `/api/objects/${o.id}/connections`)).json as any[];
const rows = () => sqlite.prepare("SELECT * FROM connections").all() as any[];

describe("Mentions", () => {
  it("make a 'mentions' Connection with Owner Origin, and it goes when the reference goes", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    const r = await body(t, `Reading ${tok(s)} again.`);
    expect(r.json.mentions[s.id]).toMatchObject({ missing: false, title: "Walden", type: "source" });
    expect(rows()).toMatchObject([{ from_id: t.id, to_id: s.id, kind: "mentions", origin: "owner" }]);
    await body(t, "Reading nothing now.");
    expect(rows()).toHaveLength(0);
  });
  it("stay when the owner gave the Connection another kind", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    await body(t, tok(s));
    const [c] = await conns(t);
    expect((await call("PATCH", `/api/connections/${c.id}`, { kind: "inspired by", subject: t.id })).status).toBe(200);
    await body(t, "gone");
    expect(rows()).toMatchObject([{ kind: "inspired by" }]);
  });
  it("never put Connection words in the text, and a repeat Mention makes no second Connection", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    await body(t, `${tok(s)} and ${tok(s)}`);
    expect(rows()).toHaveLength(1);
    expect(sqlite.prepare("SELECT text FROM blocks").all()).toEqual([{ text: `${tok(s)} and ${tok(s)}` }]);
  });
  it("don't replace an existing Connection between the pair", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    await call("POST", "/api/connections", { a: t.id, b: s.id, kind: "supports" });
    await body(t, tok(s));
    expect(rows()).toMatchObject([{ kind: "supports" }]);
    await body(t, "");
    expect(rows()).toMatchObject([{ kind: "supports" }]);
  });
  it("keep the Connection while the other Object still mentions back", async () => {
    const a = await make("thought", "A"), b = await make("thought", "B");
    await body(a, tok(b));
    await body(b, tok(a));
    await body(a, "");
    expect(rows()).toMatchObject([{ from_id: b.id, to_id: a.id, kind: "mentions" }]);
  });
  it("of a deleted Object read as missing", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    await body(t, `See ${tok(s)}.`);
    expect((await call("DELETE", `/api/objects/${s.id}`)).status).toBe(200);
    const r = (await call("GET", `/api/objects/${t.id}`)).json;
    expect(r.mentions[s.id]).toEqual({ id: s.id, missing: true });
    expect(await conns(t)).toEqual([]);
    expect(r.connectionCount).toBe(0);
  });
  it("capture's Mentions of several Sources show in the Thought body", async () => {
    const r = await call("POST", "/api/capture", { links: ["https://a.example/1", "https://b.example/2"], text: "Both agree." });
    const th = r.json.created[2];
    expect(th.blocks.map((b: any) => b.text)).toEqual(["Both agree.", tok(r.json.created[0]), tok(r.json.created[1])]);
  });
});

describe("Connections", () => {
  it("allow at most one between two Objects, whichever way round", async () => {
    const a = await make("concept", "A"), b = await make("concept", "B");
    expect((await call("POST", "/api/connections", { a: a.id, b: b.id })).status).toBe(201);
    expect((await call("POST", "/api/connections", { a: b.id, b: a.id, kind: "supports" })).status).toBe(400);
    expect((await call("POST", "/api/connections", { a: a.id, b: a.id })).status).toBe(400);
    expect(rows()).toHaveLength(1);
  });
  it("read correctly from both ends, and the kind can be changed from either end", async () => {
    const a = await make("thought", "A"), b = await make("source", "B");
    const made = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    expect(made).toMatchObject({ kind: "related", label: "related", origin: "owner" });
    await call("PATCH", `/api/connections/${made.id}`, { kind: "supports", subject: a.id });
    expect((await conns(a))[0]).toMatchObject({ label: "supports", subject: true });
    expect((await conns(b))[0]).toMatchObject({ label: "supported by", subject: false });
    // from B's side, "B builds on A" turns it round
    await call("PATCH", `/api/connections/${made.id}`, { kind: "builds on", subject: b.id });
    expect((await conns(a))[0]).toMatchObject({ label: "built on by" });
    expect((await conns(b))[0]).toMatchObject({ label: "builds on" });
    await call("PATCH", `/api/connections/${made.id}`, { kind: "contradicts" });
    expect([(await conns(a))[0].label, (await conns(b))[0].label]).toEqual(["contradicts", "contradicts"]);
    for (const k of ["inspired by", "authored by", "related"]) expect((await call("PATCH", `/api/connections/${made.id}`, { kind: k })).status).toBe(200);
    expect((await call("PATCH", `/api/connections/${made.id}`, { kind: "friends" })).status).toBe(400);
  });
  it("can't be made a Mention without a reference in the text", async () => {
    const a = await make("thought"), b = await make("source");
    const made = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    expect((await call("PATCH", `/api/connections/${made.id}`, { kind: "mentions" })).status).toBe(400);
  });
  it("carry an optional one-line note", async () => {
    const a = await make("thought"), b = await make("source");
    const made = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    await call("PATCH", `/api/connections/${made.id}`, { note: "  first line\nsecond  " });
    expect((await conns(a))[0].note).toBe("first line second");
  });
  it("show the sentence that mentions the other Object, and keep a Mention in the text from being removed here", async () => {
    const t = await make("thought"), s = await make("source", "Walden");
    await body(t, `Idle. I loved ${tok(s)} for its quiet. Then I left.`);
    const [fromS] = await conns(s);
    expect(fromS).toMatchObject({ sentence: `I loved “Walden” for its quiet.`, sentenceBy: "other", fromText: true, label: "mentioned by" });
    expect((await call("DELETE", `/api/connections/${fromS.id}`)).status).toBe(400);
  });
  it("can be removed when they do not come from the text", async () => {
    const a = await make("thought"), b = await make("source");
    const made = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    expect((await call("DELETE", `/api/connections/${made.id}`)).status).toBe(200);
    expect(rows()).toHaveLength(0);
  });
});

describe("Name search", () => {
  it("filters by Object Type, ranks by name and finds Private Objects", async () => {
    await make("source", "Deep Work");
    const p = await make("thought", "A deep secret", true);
    await make("person", "Cal Newport");
    const all = (await call("GET", "/api/search?q=deep")).json;
    expect(all.map((o: any) => o.title)).toEqual(["Deep Work", "A deep secret"]);
    expect(all[1].private).toBe(true);
    expect((await call("GET", "/api/search?q=deep&type=thought")).json.map((o: any) => o.id)).toEqual([p.id]);
    expect((await call("GET", "/api/search?q=")).json).toHaveLength(3);
  });
});

describe("Shares words with", () => {
  it("lists up to 5 Objects, locally, leaving out the connected ones, and works on Private Objects", async () => {
    const me = await make("thought", "Mycorrhizal networks", true);
    await body(me, "Fungal mycelium trades nutrients between forest trees through underground networks.");
    const near = await make("source", "Wood wide web");
    await body(near, "Underground fungal mycelium links forest trees and trades nutrients.");
    const linked = await make("source", "Already linked");
    await body(linked, "Fungal mycelium and forest trees.");
    await call("POST", "/api/connections", { a: me.id, b: linked.id });
    for (let i = 0; i < 6; i++) await body(await make("source", `Fungal ${i}`), "Fungal mycelium forest trees nutrients underground networks");
    for (let i = 0; i < 14; i++) await body(await make("person", `Unrelated ${i}`), `Completely different cooking recipes ${i}`);
    const r = (await call("GET", `/api/objects/${me.id}/shares-words`)).json;
    expect(r.length).toBe(5);
    expect(r.map((x: any) => x.id)).not.toContain(linked.id);
    expect(r.map((x: any) => x.id)).not.toContain(me.id);
    expect(r[0].shared.length).toBeGreaterThan(1);
    expect(sqlite.prepare("SELECT count(*) AS n FROM connections").get()).toEqual({ n: 1 }); // never stored
  });
});

describe("Merge", () => {
  it("moves every Connection to the kept Object, rewrites Mentions, and puts the other in the Bin", async () => {
    const keep = await make("person", "Cal Newport"), dupe = await make("person", "C. Newport");
    const x = await make("source", "Deep Work"), y = await make("thought");
    await call("POST", "/api/connections", { a: x.id, b: dupe.id, kind: "authored by" });
    await body(y, `Written by ${tok(dupe)}`);
    await call("POST", "/api/connections", { a: keep.id, b: dupe.id });
    const r = await call("POST", `/api/objects/${keep.id}/merge`, { from: dupe.id });
    expect(r.status).toBe(200);
    expect((await conns(keep)).map((c) => [c.other.title, c.label]).sort()).toEqual([["Deep Work", "author of"], ["Written by", "mentioned by"]].sort());
    expect(rows().every((c) => c.from_id !== dupe.id && c.to_id !== dupe.id)).toBe(true);
    expect(sqlite.prepare("SELECT text FROM blocks WHERE object_id = ?").get(y.id)).toEqual({ text: `Written by ${tok(keep)}` });
    expect((await call("GET", `/api/objects/${dupe.id}`)).status).toBe(404);
  });
  it("refuses two Objects of different types", async () => {
    const a = await make("person", "A"), b = await make("concept", "B");
    expect((await call("POST", `/api/objects/${a.id}/merge`, { from: b.id })).status).toBe(400);
  });
  it("keeps one Connection to a shared third Object: the owner's beats AI, a specific kind beats related", async () => {
    const keep = await make("concept", "K"), dupe = await make("concept", "D");
    const x = await make("source", "X"), z = await make("source", "Z");
    const ins = (from: string, to: string, kind: string, origin: string) =>
      sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date) VALUES (?,?,?,?,?,?,?)").run(from, to, kind, origin, origin === "ai" ? "Archivist" : null, origin === "ai" ? "m" : null, origin === "ai" ? "2026-01-01" : null);
    ins(keep.id, x.id, "related", "owner");
    ins(dupe.id, x.id, "supports", "owner"); // specific beats related
    ins(keep.id, z.id, "supports", "ai");
    ins(dupe.id, z.id, "related", "owner"); // the owner's beats AI
    expect((await call("POST", `/api/objects/${keep.id}/merge`, { from: dupe.id })).status).toBe(200);
    const mine = rows().filter((c) => c.from_id === keep.id || c.to_id === keep.id);
    expect(mine.map((c) => [c.to_id === x.id ? "x" : "z", c.kind, c.origin]).sort()).toEqual([["x", "supports", "owner"], ["z", "related", "owner"]]);
  });
  it("asks the owner when two specific kinds disagree, and keeps both notes", async () => {
    const keep = await make("concept", "K"), dupe = await make("concept", "D"), x = await make("source", "X");
    const a = (await call("POST", "/api/connections", { a: keep.id, b: x.id, kind: "supports", note: "from K" })).json;
    const b = (await call("POST", "/api/connections", { a: dupe.id, b: x.id, kind: "contradicts", note: "from D" })).json;
    const first = await call("POST", `/api/objects/${keep.id}/merge`, { from: dupe.id });
    expect(first.status).toBe(409);
    expect(first.json.needsChoice).toMatchObject([{ otherId: x.id, keep: { kind: "supports" }, drop: { kind: "contradicts" } }]);
    expect(rows()).toHaveLength(2); // nothing changed yet
    const second = await call("POST", `/api/objects/${keep.id}/merge`, { from: dupe.id, picks: { [x.id]: "drop" } });
    expect(second.status).toBe(200);
    expect(rows()).toMatchObject([{ id: a.id, kind: "contradicts", note: "from K · from D" }]);
    expect(b.id).toBeDefined();
  });
});
