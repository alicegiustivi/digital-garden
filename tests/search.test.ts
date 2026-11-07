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
const body = (o: any, ...p: string[]) => call("PUT", `/api/objects/${o.id}/body`, { paragraphs: p });
const find = async (qs: string) => (await call("GET", "/api/find?" + qs)).json;
const titles = (r: any) => r.hits.map((h: any) => h.title);

describe("Search", () => {
  it("finds titles, bodies, Tags and fields, and shows the matching sentence", async () => {
    const t = await make("thought");
    await body(t, "Nothing special here. Gardens teach patience when you wait for them.");
    const c = await make("concept", "Slow growth");
    await call("POST", `/api/objects/${c.id}/tags`, { name: "patience" });
    await call("PATCH", `/api/objects/${c.id}`, { fields: { definition: "Letting things take the time they take." } });
    const r = await find("q=patience");
    expect(r.hits).toHaveLength(2);
    const thought = r.hits.find((h: any) => h.id === t.id);
    expect(thought.match).toMatchObject({ where: "body", text: "Gardens teach patience when you wait for them.", origin: { origin: "owner" } });
    expect(r.hits.find((h: any) => h.id === c.id).match).toMatchObject({ where: "tag", text: "#patience" });
    expect(titles(await find("q=time"))).toEqual(["Slow growth"]);
  });
  it("matches the start of words and needs every word in the same Object", async () => {
    await make("concept", "Spaced repetition");
    await make("concept", "Spaced seating");
    expect(titles(await find("q=repet"))).toEqual(["Spaced repetition"]);
    expect(titles(await find("q=spaced+rep"))).toEqual(["Spaced repetition"]);
    expect((await find("q=spaced+zebra")).hits).toHaveLength(0);
  });
  it("puts a title match above a body match", async () => {
    const a = await make("thought");
    await body(a, "I keep thinking about Walden.");
    await make("source", "Walden");
    expect(titles(await find("q=walden"))[0]).toBe("Walden");
  });
  it("tolerates a typo by using the closest words in the Garden, and says so", async () => {
    await make("source", "Meditations");
    const r = await find("q=meditatoins");
    expect(titles(r)).toEqual(["Meditations"]);
    expect(r.corrected).toEqual([{ from: "meditatoins", to: ["meditations"] }]);
    expect((await find("q=zzzzqq")).hits).toHaveLength(0);
  });
  it("finds Private Objects (with the lock flag) but never the Bin", async () => {
    const p = await make("thought", "Secret plan", true);
    const gone = await make("thought", "Secret old plan");
    await call("DELETE", `/api/objects/${gone.id}`);
    const r = await find("q=secret");
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]).toMatchObject({ id: p.id, private: true });
  });
  it("shows a Source's extracted text with Source Origin, and AI Notes marked as the AI's", async () => {
    sqlite.prepare("INSERT INTO objects (id, type, updated_at) VALUES ('11111111-1111-1111-1111-111111111111', 'source', datetime('now'))").run();
    sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES ('11111111-1111-1111-1111-111111111111', 'captured', 'An essay about lighthouses and loneliness.', 'source')").run();
    const t = await make("thought", "On solitude");
    sqlite.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at) VALUES (?, 'summary', 'Reflects on isolation as a craft.', 'archivist', 'm', '2026-01-01', datetime('now'))").run(t.id);
    const a = await find("q=lighthouses");
    expect(a.hits[0].match).toMatchObject({ where: "field", label: "Captured text", origin: { origin: "source" } });
    const b = await find("q=isolation");
    expect(b.hits[0]).toMatchObject({ id: t.id, match: { where: "note", origin: { origin: "ai", aiRole: "archivist" } } });
    sqlite.prepare("DELETE FROM ai_notes").run();
    expect((await find("q=isolation")).hits).toHaveLength(0);
  });
  it("does not match the hidden id inside a Mention", async () => {
    const s = await make("source", "Walden");
    const t = await make("thought");
    await body(t, `Reading [[o:${s.id}]] again.`);
    const bit = s.id.slice(0, 8);
    expect((await find("q=" + bit)).hits).toHaveLength(0);
    expect((await find("q=walden")).hits.map((h: any) => h.id)).toEqual([s.id]); // the Thought is found by its own words, not by what it points to
  });
  it("takes the same filters as the lists: type, Tag, Unreviewed, No Connections yet, date", async () => {
    const a = await make("thought", "Alpha idea"), b = await make("concept", "Alpha field");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "x" });
    await call("POST", "/api/connections", { a: a.id, b: b.id });
    const lone = await make("thought", "Alpha alone");
    expect(titles(await find("q=alpha&type=concept"))).toEqual(["Alpha field"]);
    expect(titles(await find("q=alpha&tag=x"))).toEqual(["Alpha idea"]);
    expect(titles(await find("q=alpha&noConnections=1"))).toEqual(["Alpha alone"]);
    expect((await call("GET", "/api/objects?noConnections=1")).json.map((x: any) => x.fields[0]?.value)).toEqual(["Alpha alone"]);
    await call("POST", "/api/capture", { text: "Alpha captured" });
    expect(titles(await find("q=alpha&unreviewed=1"))).toEqual(["Alpha captured"]); // an untitled Thought is called by its first line
    expect((await find("q=alpha&since=2999-01-01T00:00:00Z")).hits).toHaveLength(0);
    expect(lone.id).toBeTruthy();
  });
  it("has four sort orders", async () => {
    await make("thought", "Banana");
    await make("thought", "Apple");
    expect(titles(await find("sort=title"))).toEqual(["Apple", "Banana"]);
    expect(titles(await find("sort=created"))).toEqual(["Apple", "Banana"]);
    expect(titles((await find("sort=changed"))).sort()).toEqual(["Apple", "Banana"]);
    expect((await find("q=a&sort=relevance")).sort).toBe("relevance");
    const list = (await call("GET", "/api/objects?sort=title")).json;
    expect(list.map((x: any) => x.fields[0].value)).toEqual(["Apple", "Banana"]);
  });
  it("gives recent items in the order asked, skipping what is in the Bin", async () => {
    const a = await make("thought", "A"), b = await make("thought", "B"), c = await make("thought", "C");
    await call("DELETE", `/api/objects/${b.id}`);
    const r = (await call("GET", `/api/recent?ids=${c.id},${b.id},${a.id},nope`)).json;
    expect(r.map((x: any) => x.title)).toEqual(["C", "A"]);
  });
});

describe("Timeline", () => {
  it("groups what was captured, written and connected", async () => {
    await call("POST", "/api/capture", { text: "A captured thought" });
    const a = await make("concept", "Made on purpose"), b = await make("concept", "Another");
    await call("POST", "/api/connections", { a: a.id, b: b.id });
    const { events, next } = (await call("GET", "/api/timeline")).json;
    expect(next).toBeNull();
    const kinds = events.map((e: any) => e.kind).sort();
    expect(kinds).toEqual(["captured", "connected", "written", "written"]);
    const link = events.find((e: any) => e.kind === "connected");
    expect(link.object.title).toBeTruthy();
    expect(link.other.title).toBeTruthy();
  });
  it("counts a later change as written, hides the Bin, and pages backwards", async () => {
    const a = await make("thought", "Old one");
    sqlite.prepare("UPDATE objects SET created_at = '2026-01-01 10:00:00', updated_at = '2026-01-03 10:00:00' WHERE id = ?").run(a.id);
    const gone = await make("thought", "Binned");
    await call("DELETE", `/api/objects/${gone.id}`);
    const all = (await call("GET", "/api/timeline")).json.events;
    expect(all.map((e: any) => e.object.title)).toEqual(["Old one", "Old one"]);
    expect(all.map((e: any) => e.detail)).toEqual(["edited", "started"]);
    const first = (await call("GET", "/api/timeline?limit=1")).json;
    expect(first.next).toBe(first.events[0].at);
    const second = (await call("GET", `/api/timeline?limit=1&before=${first.next}`)).json;
    expect(second.events[0].detail).toBe("started");
  });
  it("does not show a Connection that points into the Bin", async () => {
    const a = await make("concept", "Here"), b = await make("concept", "Gone soon");
    await call("POST", "/api/connections", { a: a.id, b: b.id });
    await call("DELETE", `/api/objects/${b.id}`);
    expect((await call("GET", "/api/timeline")).json.events.some((e: any) => e.kind === "connected")).toBe(false);
  });
});

describe("Tags: Rename and Merge", () => {
  const tagOn = async (o: any, name: string) => (await call("POST", `/api/objects/${o.id}/tags`, { name })).json.tags.find((t: any) => t.name === name);
  it("renames a Tag everywhere, makes it the owner's, and can be undone", async () => {
    const a = await make("thought");
    const t = await tagOn(a, "old");
    sqlite.prepare("UPDATE object_tags SET origin = 'ai', ai_role = 'archivist', ai_model = 'm', ai_date = '2026-01-01' WHERE tag_id = ?").run(t.id);
    const r = await call("POST", `/api/tags/${t.id}/rename`, { name: "#New Name" });
    expect(r.json.tags).toMatchObject([{ name: "new-name", count: 1 }]);
    expect((await call("GET", `/api/objects/${a.id}`)).json.tags[0]).toMatchObject({ name: "new-name", origin: "owner" });
    await call("POST", `/api/tags/${t.id}/rename/undo`, r.json.was);
    expect((await call("GET", `/api/objects/${a.id}`)).json.tags[0]).toMatchObject({ name: "old", origin: "ai", aiRole: "archivist" });
  });
  it("refuses a name already taken, pointing to Merge", async () => {
    const a = await make("thought");
    const t = await tagOn(a, "one");
    await tagOn(a, "two");
    const r = await call("POST", `/api/tags/${t.id}/rename`, { name: "two" });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/Merge/);
  });
  it("merges one Tag into another, keeping each Origin, and can be undone", async () => {
    const a = await make("thought"), b = await make("thought"), c = await make("thought");
    const keep = await tagOn(a, "keep");
    await tagOn(b, "keep");
    const drop = await tagOn(b, "drop");
    await tagOn(c, "drop");
    sqlite.prepare("UPDATE object_tags SET origin = 'ai', ai_role = 'archivist', ai_model = 'm', ai_date = '2026-01-01' WHERE tag_id = ? AND object_id = ?").run(drop.id, c.id);
    const r = await call("POST", `/api/tags/${drop.id}/merge`, { into: keep.id });
    expect(r.json.tags).toMatchObject([{ name: "keep", count: 3 }]);
    expect((await call("GET", `/api/objects/${c.id}`)).json.tags[0]).toMatchObject({ name: "keep", origin: "ai" });
    expect((await call("POST", `/api/tags/${keep.id}/merge`, { into: keep.id })).status).toBe(400);
    await call("POST", "/api/tags/unmerge", r.json.merged);
    const tags = (await call("GET", "/api/tags")).json;
    expect(tags.map((t: any) => [t.name, t.count])).toEqual([["drop", 2], ["keep", 2]]);
  });
});
