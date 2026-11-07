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
const make = async (type: string, title?: string) => (await call("POST", "/api/objects", { type, title })).json;

describe("Object Types", () => {
  it("lists the four core types with their fields", async () => {
    const { types } = (await call("GET", "/api/types")).json;
    expect(types.map((t: any) => t.key)).toEqual(["source", "concept", "thought", "person"]);
    const keys = (t: string) => types.find((x: any) => x.key === t).fields.map((f: any) => f.key);
    expect(keys("source")).toEqual(["captured", "format", "status", "authors", "published", "link", "extraction"]);
    expect(keys("concept")).toEqual(["definition", "aliases"]);
    expect(keys("thought")).toEqual(["kind"]);
    expect(keys("person")).toEqual(["description", "years", "links"]);
  });
  it("refuses an unknown type", async () => {
    expect((await call("POST", "/api/objects", { type: "recipe" })).status).toBe(400);
    expect(() => sqlite.prepare("INSERT INTO objects (id, type) VALUES ('x','recipe')").run()).toThrow(/unknown Object Type/);
  });
});

describe("making and editing Objects", () => {
  it("makes an Object whose title is the owner's", async () => {
    const o = await make("source", "Gödel, Escher, Bach");
    expect(o.type).toBe("source");
    expect(o.fields).toEqual([{ key: "title", value: "Gödel, Escher, Bach", origin: "owner", aiRole: null, aiModel: null, aiDate: null, approved: false }]);
  });
  it("edits fields and clears one when emptied", async () => {
    const o = await make("source", "A book");
    let r = (await call("PATCH", `/api/objects/${o.id}`, { fields: { format: "book", authors: "Hofstadter" } })).json;
    expect(r.fields.map((f: any) => f.key).sort()).toEqual(["authors", "format", "title"]);
    r = (await call("PATCH", `/api/objects/${o.id}`, { fields: { authors: "" } })).json;
    expect(r.fields.map((f: any) => f.key).sort()).toEqual(["format", "title"]);
  });
  it("editing an AI value makes it the owner's", async () => {
    const o = await make("source", "A book");
    sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date) VALUES (?, 'authors', 'Hofstadtr', 'ai', 'archivist', 'm:free', '2026-11-06')").run(o.id);
    const r = (await call("PATCH", `/api/objects/${o.id}`, { fields: { authors: "Hofstadter" } })).json;
    const f = r.fields.find((x: any) => x.key === "authors");
    expect(f).toMatchObject({ value: "Hofstadter", origin: "owner", aiRole: null });
  });
  it("changing type keeps every value, including ones that don't fit", async () => {
    const o = await make("source", "Mycelium");
    await call("PATCH", `/api/objects/${o.id}`, { fields: { format: "book", authors: "Sheldrake" } });
    const r = (await call("PATCH", `/api/objects/${o.id}`, { type: "concept" })).json;
    expect(r.type).toBe("concept");
    expect(r.fields.map((f: any) => f.key).sort()).toEqual(["authors", "format", "title"]);
    const back = (await call("PATCH", `/api/objects/${o.id}`, { type: "source" })).json;
    expect(back.fields.find((f: any) => f.key === "authors").value).toBe("Sheldrake");
  });
  it("saves the body as the owner's blocks and leaves Source blocks alone", async () => {
    const o = await make("source", "A book");
    sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, 0, 'quoted', 'source')").run(o.id);
    await call("PUT", `/api/objects/${o.id}/body`, { paragraphs: ["First.", "", "Second."] });
    let r = (await call("PUT", `/api/objects/${o.id}/body`, { paragraphs: ["First.", "", "Second."] })).json;
    expect(r.blocks.map((b: any) => [b.text, b.origin])).toEqual([["quoted", "source"], ["First.", "owner"], ["Second.", "owner"]]);
    r = (await call("PUT", `/api/objects/${o.id}/body`, { paragraphs: [] })).json;
    expect(r.blocks.map((b: any) => b.text)).toEqual(["quoted"]);
  });
  it("makes the body findable by search", async () => {
    const o = await make("thought");
    await call("PUT", `/api/objects/${o.id}/body`, { paragraphs: ["Lichen is two things at once"] });
    expect(sqlite.prepare("SELECT object_id FROM search_index WHERE search_index MATCH 'lichen'").all()).toEqual([{ object_id: o.id }]);
  });
  it("sets Private", async () => {
    const o = await make("thought");
    expect((await call("PATCH", `/api/objects/${o.id}`, { private: true })).json.private).toBe(true);
  });
});

describe("Tags", () => {
  it("adds a Tag with the owner's Origin, tidies the name, and gives it a colour", async () => {
    const o = await make("thought");
    const r = (await call("POST", `/api/objects/${o.id}/tags`, { name: "  #To Read " })).json;
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0]).toMatchObject({ name: "to-read", origin: "owner", color: "blue" });
  });
  it("gives each new Tag the next colour and reuses an existing Tag", async () => {
    const a = await make("thought");
    const b = await make("thought");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "one" });
    await call("POST", `/api/objects/${a.id}/tags`, { name: "two" });
    await call("POST", `/api/objects/${b.id}/tags`, { name: "TWO" });
    const tags = (await call("GET", "/api/tags")).json;
    expect(tags.map((t: any) => [t.name, t.color, t.count])).toEqual([["one", "blue", 1], ["two", "rose", 2]]);
  });
  it("removes a Tag from an Object and recolours a Tag", async () => {
    const o = await make("thought");
    const r = (await call("POST", `/api/objects/${o.id}/tags`, { name: "x" })).json;
    await call("PATCH", `/api/tags/${r.tags[0].id}`, { color: "green" });
    expect((await call("GET", "/api/tags")).json[0].color).toBe("green");
    expect((await call("PATCH", `/api/tags/${r.tags[0].id}`, { color: "mauve" })).status).toBe(400);
    expect((await call("DELETE", `/api/objects/${o.id}/tags/${r.tags[0].id}`)).json.tags).toEqual([]);
  });
});

describe("lists", () => {
  it("lists by type and by Tag, newest first, and skips the Bin", async () => {
    const a = await make("source", "A");
    const b = await make("thought", "B");
    const c = await make("source", "C");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "x" });
    sqlite.prepare("UPDATE objects SET updated_at = datetime('now','-1 day') WHERE id = ?").run(a.id);
    sqlite.prepare("UPDATE objects SET deleted_at = datetime('now') WHERE id = ?").run(c.id);
    const titles = (path: string) => call("GET", path).then((r) => r.json.map((x: any) => x.fields.find((f: any) => f.key === "title")?.value));
    expect(await titles("/api/objects?type=source")).toEqual(["A"]);
    expect(await titles("/api/objects")).toEqual(["B", "A"]);
    expect(await titles("/api/objects?tag=x")).toEqual(["A"]);
    expect(b.id).toBeTruthy();
  });
  it("this week only returns recent Objects", async () => {
    const a = await make("source", "Old");
    await make("source", "New");
    sqlite.prepare("UPDATE objects SET updated_at = datetime('now','-10 days') WHERE id = ?").run(a.id);
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const r = (await call("GET", `/api/objects?since=${encodeURIComponent(since)}`)).json;
    expect(r).toHaveLength(1);
  });
});
