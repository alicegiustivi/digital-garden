import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-types-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate } = await import("../src/server/ai-gate.ts");
const { createAi } = await import("../src/server/ai-queue.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");
const { search } = await import("../src/server/search.ts");
const ex = await import("../src/server/export.ts");
const dk = await import("../src/server/desk.ts");

// A pretend OpenRouter, as in ai.test.ts.
let replies: string[], sent: any[], clock: Date;
const fakeFetch = (async (_url: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() ?? '{"tags":[]}' } }] }), { status: 200 });
}) as unknown as typeof fetch;

let sqlite: ReturnType<typeof openDb>["sqlite"], app: ReturnType<typeof createApp>, ai: ReturnType<typeof createAi>;
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  replies = []; sent = []; clock = new Date("2026-11-10T10:00:00Z");
  ai = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
  app = createApp(sqlite, { readLink: () => {}, ai });
});
const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const types = async () => (await call("GET", "/api/types")).json.types as any[];
const typeOf = async (key: string) => (await types()).find((t) => t.key === key);
const makeType = async (label = "Book", extra: object = {}) => (await call("POST", "/api/types", { label, color: "teal", icon: "book", ...extra })).json.key as string;
const makeObject = async (type: string, title?: string) => (await call("POST", "/api/objects", { type, title })).json.id as string;

describe("the four core types after the migration", () => {
  it("keep exactly the colours and icons they always had, and are marked core", async () => {
    const t = await types();
    expect(t.map((x) => [x.key, x.color, x.icon, x.core])).toEqual([
      ["source", "ocean", "source", true], ["concept", "violet", "concept", true], ["thought", "gold", "thought", true], ["person", "coral", "person", true],
    ]);
  });
  it("still refuse an Object of an unknown type, in the database itself", () => {
    expect(() => sqlite.prepare("INSERT INTO objects (id, type) VALUES ('z', 'x-nothing')").run()).toThrow(/unknown Object Type/);
  });
});

describe("making and shaping types (the owner's act)", () => {
  it("makes a type with a name, plural, colour and icon; its key is its own and never changes", async () => {
    const r = await call("POST", "/api/types", { label: "Book", color: "teal", icon: "book" });
    expect(r.status).toBe(201);
    expect(r.json.key).toBe("x-book");
    expect(await typeOf("x-book")).toMatchObject({ label: "Book", plural: "Books", color: "teal", icon: "book", core: false, count: 0, fields: [] });
    await call("PATCH", "/api/types/x-book", { label: "Novel", plural: "Novels", color: "rose", icon: "film" });
    expect(await typeOf("x-book")).toMatchObject({ key: "x-book", label: "Novel", plural: "Novels", color: "rose", icon: "film" });
  });
  it("only accepts palette colours and the icons in the set", async () => {
    expect((await call("POST", "/api/types", { label: "A", color: "#ff0000", icon: "book" })).status).toBe(400);
    expect((await call("POST", "/api/types", { label: "A", color: "teal", icon: "skull" })).status).toBe(400);
    expect((await call("POST", "/api/types", { label: "", color: "teal", icon: "book" })).status).toBe(400);
    await makeType("Book");
    expect((await call("POST", "/api/types", { label: "book", color: "rose", icon: "film" })).status).toBe(400); // the same name again
    expect((await call("POST", "/api/types", { label: "Source", color: "rose", icon: "film" })).status).toBe(400);
  });
  it("keys cannot clash with the screen's own CSS names, whatever the type is called", async () => {
    for (const name of ["Menu", "Peek", "Toast", "Source"]) { const r = await call("POST", "/api/types", { label: name + " thing", color: "teal", icon: "book" }); expect(r.json.key).toMatch(/^x-[a-z0-9-]+$/); }
  });
  it("lets the owner change the colour of a core type, and nothing else about it", async () => {
    await call("PATCH", "/api/types/thought", { color: "indigo" });
    expect((await typeOf("thought")).color).toBe("indigo");
    expect((await call("PATCH", "/api/types/thought", { label: "Idea" })).status).toBe(400);
    expect((await call("PATCH", "/api/types/person", { icon: "book" })).status).toBe(400);
    expect((await call("POST", "/api/types/person/fields", { label: "Age", input: "text" })).status).toBe(400);
    expect((await call("DELETE", "/api/types/source")).status).toBe(400);
  });
  it("reorders types, core ones included", async () => {
    const k = await makeType("Book");
    const keys = (await types()).map((t) => t.key);
    await call("PUT", "/api/types/order", { keys: [k, ...keys.filter((x) => x !== k)] });
    expect((await types())[0].key).toBe(k);
    expect((await call("PUT", "/api/types/order", { keys: [k] })).status).toBe(400);
  });
  it("gives a type its own properties: short text, long text or a choice; renames, reorders, and shows one under the title", async () => {
    const k = await makeType("Book");
    const a = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text", lead: true })).json.field;
    const b = (await call("POST", `/api/types/${k}/fields`, { label: "Review", input: "longtext" })).json.field;
    const c = (await call("POST", `/api/types/${k}/fields`, { label: "Shelf", input: "select", options: ["to read", "read"] })).json.field;
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Bad", input: "select", options: ["only one"] })).status).toBe(400);
    expect((await call("POST", `/api/types/${k}/fields`, { label: "author", input: "text" })).status).toBe(400);
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Date", input: "date" })).status).toBe(400); // dates and links are a later question
    let t = await typeOf(k);
    expect(t.fields.map((f: any) => [f.label, f.input, f.lead])).toEqual([["Author", "text", true], ["Review", "longtext", false], ["Shelf", "select", false]]);
    await call("PATCH", `/api/types/${k}/fields/${b}`, { label: "My review", lead: true }); // only one is shown under the title
    await call("PUT", `/api/types/${k}/fields/order`, { keys: [c, b, a] });
    t = await typeOf(k);
    expect(t.fields.map((f: any) => [f.label, f.lead])).toEqual([["Shelf", false], ["My review", true], ["Author", false]]);
    await call("PATCH", `/api/types/${k}/fields/${c}`, { options: ["to read", "reading", "read"] });
    expect((await typeOf(k)).fields[0].options).toEqual(["to read", "reading", "read"]);
  });
  it("an Object of a custom type takes values in its properties, and a value survives renaming the property", async () => {
    const k = await makeType("Book");
    const a = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text" })).json.field;
    const id = await makeObject(k, "Dune");
    const o = (await call("PATCH", `/api/objects/${id}`, { fields: { [a]: "Frank Herbert" } })).json;
    expect(o.fields.find((f: any) => f.key === a)).toMatchObject({ value: "Frank Herbert", origin: "owner" });
    await call("PATCH", `/api/types/${k}/fields/${a}`, { label: "Writer" });
    expect((await call("GET", `/api/objects/${id}`)).json.fields.find((f: any) => f.key === a).value).toBe("Frank Herbert");
  });
  it("says what removing a property will take before anything is lost, then removes the values only when told to", async () => {
    const k = await makeType("Book");
    const a = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text" })).json.field;
    const one = await makeObject(k, "One"), two = await makeObject(k, "Two");
    await call("PATCH", `/api/objects/${one}`, { fields: { [a]: "X" } });
    await call("PATCH", `/api/objects/${two}`, { fields: { [a]: "Y" } });
    await call("DELETE", `/api/objects/${two}`); // in the Bin
    expect((await call("GET", `/api/types/${k}/fields/${a}/removal`)).json).toEqual({ values: 2, inBin: 1 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM field_values WHERE field = ?").get(a)).toEqual({ n: 2 }); // asking removed nothing
    const r = await call("DELETE", `/api/types/${k}/fields/${a}`);
    expect(r.json.removed).toEqual({ values: 2, inBin: 1 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM field_values WHERE field = ?").get(a)).toEqual({ n: 0 });
    expect((await typeOf(k)).fields).toEqual([]);
  });
});

describe("deleting or moving a type", () => {
  it("cannot remove a type that has Objects, the Bin included; offers to move them first; then it can go", async () => {
    const k = await makeType("Book");
    const a = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text" })).json.field;
    const live = await makeObject(k, "Live"), binned = await makeObject(k, "Binned");
    await call("DELETE", `/api/objects/${binned}`);
    const refused = await call("DELETE", `/api/types/${k}`);
    expect(refused.status).toBe(400);
    expect(refused.json.error).toMatch(/2 Objects \(1 in the Bin\)\. Move them to another type first/);
    expect(await typeOf(k)).toMatchObject({ count: 1, inBin: 1 });
    const moved = await call("POST", `/api/types/${k}/move`, { to: "source" });
    expect(moved.json.moved).toBe(2);
    expect(sqlite.prepare("SELECT type FROM objects WHERE id IN (?, ?)").all(live, binned)).toEqual([{ type: "source" }, { type: "source" }]);
    expect((await call("DELETE", `/api/types/${k}`)).status).toBe(200);
    expect(await typeOf(k)).toBeUndefined();
    expect(sqlite.prepare("SELECT 1 FROM field_definitions WHERE key = ?").get(a)).toBeUndefined(); // its properties go with it
    expect((await call("POST", `/api/types/source/move`, { to: "source" })).status).toBe(400);
  });
  it("the trigger still refuses a type that does not exist", async () => {
    expect((await call("POST", "/api/objects", { type: "x-ghost" })).status).toBe(400);
    expect((await call("PATCH", `/api/objects/${await makeObject("source")}`, { type: "x-ghost" })).status).toBe(400);
  });
});

describe("a custom type is a plain Object", () => {
  it("gets a title, body, Tags, Connections, Private, the Bin and Search like any other", async () => {
    const k = await makeType("Place");
    const id = await makeObject(k, "Lisbon");
    await call("PUT", `/api/objects/${id}/body`, { paragraphs: ["Tram 28 climbs the hill"] });
    await call("POST", `/api/objects/${id}/tags`, { name: "travel" });
    const other = await makeObject("thought");
    await call("POST", "/api/connections", { a: id, b: other, kind: "related" });
    expect((await call("GET", `/api/objects/${id}`)).json).toMatchObject({ type: k, connectionCount: 1, tags: [{ name: "travel" }] });
    expect(search(sqlite, { q: "tram" }).hits.map((h: any) => h.id)).toContain(id);
    expect((await call("GET", `/api/objects?type=${k}`)).json).toHaveLength(1);
    await call("PATCH", `/api/objects/${id}`, { private: true });
    await call("DELETE", `/api/objects/${id}`);
    expect((await call("GET", `/api/objects?type=${k}`)).json).toHaveLength(0);
    await call("POST", `/api/objects/${id}/restore`);
    expect((await call("GET", `/api/objects/${id}`)).json.private).toBe(true);
  });
  it("gets none of the special rules: no portrait, no Open Question, no Concept version, no link reading", async () => {
    const k = await makeType("Place");
    const id = await makeObject(k, "Lisbon");
    expect((await call("GET", `/api/objects/${id}`)).json.portrait).toBeNull();
    const form = new FormData(); form.set("image", new File([new Uint8Array([1])], "p.jpg"));
    expect((await app.request(`/api/objects/${id}/portrait`, { method: "PUT", body: form })).status).toBe(400);
    expect(() => dk.setQuestion(sqlite, id, { state: "open" })).toThrow(/Only a Thought/);
    await call("PUT", `/api/objects/${id}/body`, { paragraphs: ["my view"] });
    expect(sqlite.prepare("SELECT count(*) AS n FROM concept_versions WHERE object_id = ?").get(id)).toEqual({ n: 0 });
  });
  it("can be made from the Capture window as words only, as an Unreviewed Object", async () => {
    const k = await makeType("Place");
    const r = await call("POST", "/api/capture", { text: "Lisbon trams", type: k });
    expect(r.json.created[0]).toMatchObject({ type: k, unreviewed: true });
    expect((await call("POST", "/api/capture", { text: "x", type: "thought" })).status).toBe(400); // Capture decides core types itself
    expect((await call("POST", "/api/capture", { text: "x", type: k, links: ["https://example.com/a"] })).status).toBe(400);
    expect((await call("POST", "/api/capture", { text: "x", type: "x-ghost" })).status).toBe(400);
  });
});

describe("the AI treats a custom type's Objects like any others, and never shapes types", () => {
  const setup = async () => {
    const k = await makeType("Book");
    const author = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text" })).json.field as string;
    const shelf = (await call("POST", `/api/types/${k}/fields`, { label: "Shelf", input: "select", options: ["to read", "read"] })).json.field as string;
    const note = (await call("POST", `/api/types/${k}/fields`, { label: "About", input: "longtext" })).json.field as string;
    return { k, author, shelf, note };
  };
  const val = (id: string, f: string) => sqlite.prepare("SELECT * FROM field_values WHERE object_id = ? AND field = ?").get(id, f) as any;
  const runArchivist = async (id: string, reply: object | string, ...more: string[]) => {
    replies.push(typeof reply === "string" ? reply : JSON.stringify(reply), ...more);
    await call("POST", `/api/objects/${id}/ai/run`);
    later(5);
    await ai.tick();
  };

  it("adds Tags and fills the type's properties from the text, marked ✦ and undone in one click; a value the text does not state is never written", async () => {
    const { k, author, shelf, note } = await setup();
    const id = (await call("POST", "/api/capture", { text: "Dune by Frank Herbert is on my to read list. A desert planet and a fight over spice.", type: k })).json.created[0].id;
    await runArchivist(id, { tags: ["spice", "desert-planet"], properties: { [author]: "Frank Herbert", [shelf]: "to read", [note]: "A desert planet and a fight over spice.", ["c-unknown"]: "x" } });
    expect(val(id, author)).toMatchObject({ value: "Frank Herbert", origin: "ai", ai_role: "Archivist" });
    expect(val(id, shelf)).toMatchObject({ value: "to read", origin: "ai" });
    expect(val(id, note)).toMatchObject({ origin: "ai" });
    expect(sqlite.prepare("SELECT field FROM field_values WHERE object_id = ? AND field = 'c-unknown'").get(id)).toBeUndefined();
    expect((await call("GET", `/api/objects/${id}`)).json.tags.map((t: any) => [t.name, t.origin])).toEqual([["desert-planet", "ai"], ["spice", "ai"]]);
    expect((await call("POST", `/api/objects/${id}/ai/undo`)).status).toBe(200);
    expect(val(id, author)).toBeUndefined(); expect(val(id, shelf)).toBeUndefined();
    expect((await call("GET", `/api/objects/${id}`)).json.tags).toEqual([]);
  });
  it("never invents: a short value or choice the text does not state, and a choice that is not an option, are dropped", async () => {
    const { k, author, shelf } = await setup();
    const id = (await call("POST", "/api/capture", { text: "A novel about a desert planet.", type: k })).json.created[0].id;
    await runArchivist(id, { tags: [], properties: { [author]: "Frank Herbert", [shelf]: "abandoned" } });
    expect(val(id, author)).toBeUndefined();
    expect(val(id, shelf)).toBeUndefined();
  });
  it("never touches a value the owner wrote", async () => {
    const { k, author } = await setup();
    const id = (await call("POST", "/api/capture", { text: "By Frank Herbert", type: k })).json.created[0].id;
    await call("PATCH", `/api/objects/${id}`, { fields: { [author]: "F. Herbert" } });
    await runArchivist(id, { tags: [], properties: { [author]: "Frank Herbert" } });
    expect(val(id, author)).toMatchObject({ value: "F. Herbert", origin: "owner" });
  });
  it("adds a related Connection directly (marked ✦, undoable), and the prompt shows the type's own name and properties", async () => {
    const { k, author } = await setup();
    const other = await makeObject("source", "Desert ecology");
    await call("PUT", `/api/objects/${other}/body`, { paragraphs: ["Deserts and spice trade"] });
    const id = (await call("POST", "/api/capture", { text: "Dune, a desert planet and spice", type: k })).json.created[0].id;
    await runArchivist(id, { tags: ["spice"] }, JSON.stringify({ related: [{ ref: "c1", why: "both about deserts" }], specific: [] }));
    const prompt = sent[0].messages.map((m: any) => (typeof m.content === "string" ? m.content : "")).join("\n");
    expect(prompt).toContain("Kind of Object: Book");
    expect(prompt).toContain(`${author}: Author`);
    const c = sqlite.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ?").all(id, id) as any[];
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "related", origin: "ai", approved: 0 });
    expect(archivistPrompt(sqlite, id)!.candidates.map((x) => x.id)).not.toContain(other); // now connected, so no longer a candidate
  });
  it("never creates a type and never moves an Object into one, even if the model names one", async () => {
    const { k } = await setup();
    const id = (await call("POST", "/api/capture", { links: ["https://example.com/x"], text: "words" })).json.created[0].id;
    sqlite.prepare("UPDATE field_values SET value = 'extracted' WHERE object_id = ? AND field = 'extraction'").run(id);
    const typesBefore = (await types()).length;
    await runArchivist(id, { type: k, tags: ["a"], format: "book" }, JSON.stringify({ related: [], specific: [] }));
    await runArchivist(id, { type: "x-brand-new", tags: ["b"] });
    expect((await types()).length).toBe(typesBefore);
    expect(sqlite.prepare("SELECT type FROM objects WHERE id = ?").get(id)).toEqual({ type: "source" });
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_suggestions WHERE kind = 'type'").get()).toEqual({ n: 0 });
    // the prompt tells the model the only types it may name, and a custom type is not among them
    expect(sent[0].messages[0].content).toContain('"type" is "source" or "person" only');
  });
  it("never reads a Private Object of a custom type, and the Researcher never does either", async () => {
    const { k } = await setup();
    const id = (await call("POST", "/api/capture", { text: "my private plans", type: k, private: true })).json.created[0].id;
    expect(archivistPrompt(sqlite, id)).toBeNull();
    await call("POST", `/api/objects/${id}/ai/run`);
    later(5);
    await ai.tick();
    expect(sent).toHaveLength(0);
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_jobs WHERE object_id = ? AND status <> 'cancelled'").get(id)).toEqual({ n: 0 });
  });
  it("only the owner's routes make or change types: no AI module imports the type-making code", () => {
    const dir = join(process.cwd(), "src/server");
    for (const f of readdirSync(dir).filter((f) => /^(ai-.*|archivist|researcher|suggestions|describe)\.ts$/.test(f))) {
      expect(readFileSync(join(dir, f), "utf8"), f).not.toMatch(/from "\.\/types\.ts"/);
    }
  });
});

describe("Export and restore carry custom types", () => {
  it("Export lists the type's folder by plural name, its colour, icon and fields, and nothing from the Bin", async () => {
    const k = await makeType("Book");
    const a = (await call("POST", `/api/types/${k}/fields`, { label: "Author", input: "text", lead: true })).json.field;
    const id = await makeObject(k, "Dune");
    await call("PATCH", `/api/objects/${id}`, { fields: { [a]: "Frank Herbert" } });
    const gone = await makeObject(k, "In the bin");
    await call("DELETE", `/api/objects/${gone}`);
    const g = ex.gatherGarden(sqlite, {}, new Date("2026-11-10T10:00:00"));
    const t = g.objectTypes.find((x) => x.key === k)!;
    expect(t).toMatchObject({ label: "Book", plural: "Books", core: false, color: "teal", icon: "book", colorLight: "#0f766e", colorDark: "#2dd4bf" });
    expect(t.fields).toEqual([{ key: a, label: "Author", input: "text", options: null, lead: true }]);
    expect(g.objects.map((o) => o.id)).toContain(id);
    expect(g.objects.map((o) => o.id)).not.toContain(gone);
    expect(JSON.stringify(g)).not.toContain("In the bin");
  });
});
