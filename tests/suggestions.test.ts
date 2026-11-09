import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-suggest-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate } = await import("../src/server/ai-gate.ts");
const { createAi } = await import("../src/server/ai-queue.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");

// A pretend OpenRouter with scripted replies. Every request is kept so tests can read what was sent.
let replies: string[], sent: { body: any }[], clock: Date;
const fakeFetch = (async (_url: string, init: any) => {
  sent.push({ body: JSON.parse(init.body) });
  const content = replies.shift() ?? "{}";
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}) as unknown as typeof fetch;

let sqlite: ReturnType<typeof openDb>["sqlite"];
let ai: ReturnType<typeof createAi>;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  replies = []; sent = []; clock = new Date("2026-11-07T10:00:00Z");
  ai = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
  app = createApp(sqlite, { readLink: () => {}, ai });
});
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, json: (text.startsWith("{") || text.startsWith("[") ? JSON.parse(text) : text) as any };
};
const make = async (type: string, title?: string, extra: object = {}) => (await call("POST", "/api/objects", { type, title, ...extra })).json;
const setFields = (id: string, fields: object) => call("PATCH", `/api/objects/${id}`, { fields });
const sugg = async (id: string) => (await call("GET", `/api/objects/${id}/suggestions`)).json;
const notes = async (id: string) => (await call("GET", `/api/objects/${id}/ai-notes`)).json;
const reply = (j: object) => replies.push(JSON.stringify(j));
/** Make the Archivist look at one Object, with its scripted reply, and wait until it has. */
const look = async (id: string, j: object) => {
  reply(j);
  await call("POST", `/api/objects/${id}/ai/run`);
  clock = new Date(clock.getTime() + 10_000);
  await ai.tick();
};
const refOf = (id: string, title: string) => archivistPrompt(sqlite, id)!.candidates.find((c) => c.title === title)?.ref;

describe("what the Archivist is shown to connect to", () => {
  it("lists only Objects it may read: never Private, never a Thought, never one already connected", async () => {
    const src = await make("source", "Gardens");
    const open = await make("source", "Gardens again");
    const secret = await make("source", "Gardens secretly", { private: true });
    const thought = await make("thought");
    await setFields(thought.id, { title: "Gardens thought" });
    const linked = await make("source", "Gardens linked");
    await call("POST", "/api/connections", { a: src.id, b: linked.id });
    const p = archivistPrompt(sqlite, src.id)!;
    expect(p.candidates.map((c) => c.title)).toContain("Gardens again");
    expect(p.candidates.map((c) => c.title)).not.toContain("Gardens secretly");
    expect(p.candidates.map((c) => c.title)).not.toContain("Gardens thought");
    expect(p.candidates.map((c) => c.title)).not.toContain("Gardens linked");
    const text = JSON.stringify(p.messages);
    expect(text).not.toContain(secret.id);
    expect(text).not.toContain("secretly");
    expect(open.id).toBeTruthy();
  });
  it("offers nothing to connect to a Thought", async () => {
    await make("person", "Ada Green");
    const th = await make("thought");
    expect(archivistPrompt(sqlite, th.id)!.candidates).toEqual([]);
  });
});

/** A Suggestion that still waits for approval (a specific kind, as the Researcher or an older Archivist might leave): seeded directly. */
const seedWaiting = (objectId: string, otherId: string, kind: string, role = "Archivist") =>
  Number(sqlite.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'connection', ?, ?, 'm-test', '2026-11-07', '2026-11-07T09:00:00Z')").run(objectId, JSON.stringify({ otherId, kind }), role).lastInsertRowid);
const conns = async (id: string) => (await call("GET", `/api/objects/${id}/connections`)).json as any[];

describe("Archivist Connections apply directly (issue #66)", () => {
  it("adds related Connections at once (up to the cap of 10), marked AI and not yet approved, with role, model and date", async () => {
    const src = await make("source", "Soil and gardens");
    const refs: string[] = [];
    for (let i = 0; i < 12; i++) await make("source", `Soil gardens ${i}`);
    for (let i = 0; i < 12; i++) refs.push(refOf(src.id, `Soil gardens ${i}`)!);
    await look(src.id, { tags: [], related: refs, summary: null });
    const c = await conns(src.id);
    expect(c).toHaveLength(10);
    expect(c[0]).toMatchObject({ kind: "related", origin: "ai", aiRole: "Archivist", approved: false });
    expect(c[0].aiModel).toBeTruthy();
    expect(c[0].aiDate).toBe("2026-11-07");
    expect((await sugg(src.id)).pending).toEqual([]); // nothing waits for approval
    expect((await call("GET", `/api/objects/${src.id}/ai`)).json.run.connections).toBe(10);
  });
  it("the cap lives in one setting", async () => {
    const { AI_CONFIG } = await import("../src/server/ai-config.ts");
    expect(AI_CONFIG.maxConnections).toBe(10);
    expect(String(archivistPrompt(sqlite, (await make("source", "X")).id)!.messages[0].content)).toContain(`At most ${AI_CONFIG.maxConnections}.`);
  });
  it("ignores a ref it was never shown, and a pair that is already connected", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    await call("POST", "/api/connections", { a: a.id, b: b.id });
    await look(a.id, { related: ["c99", "c1"] });
    expect(await conns(a.id)).toHaveLength(1);
    expect((await conns(a.id))[0].origin).toBe("owner");
  });
  it("one click on one Connection takes it back, and it is remembered from both ends and not proposed again", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    await look(a.id, { related: [refOf(a.id, "Bees gardens two")] });
    const [c] = await conns(a.id);
    expect((await call("POST", `/api/connections/${c.id}/undo-ai`)).status).toBe(200);
    expect(await conns(a.id)).toEqual([]);
    expect(archivistPrompt(sqlite, a.id)!.candidates.map((x) => x.id)).not.toContain(b.id);
    expect(archivistPrompt(sqlite, b.id)!.candidates.map((x) => x.id)).not.toContain(a.id);
    await look(a.id, { related: ["c1"] });
    expect(await conns(a.id)).toEqual([]);
    // unless the owner asks
    await call("POST", `/api/objects/${a.id}/ai/forget-rejected`);
    await look(a.id, { related: [refOf(a.id, "Bees gardens two")] });
    expect(await conns(a.id)).toHaveLength(1);
  });
  it("cannot undo this way a Connection the owner made or approved", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    const own = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    expect((await call("POST", `/api/connections/${own.id}/undo-ai`)).status).toBe(404);
    expect(await conns(a.id)).toHaveLength(1);
  });
  it("the run's Undo takes back the Tags and the Connections together, and remembers both", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    await look(a.id, { tags: ["bees"], related: [refOf(a.id, "Bees gardens two")] });
    expect((await call("GET", `/api/objects/${a.id}/ai`)).json.run).toMatchObject({ tags: ["bees"], connections: 1 });
    expect((await call("POST", `/api/objects/${a.id}/ai/undo`)).status).toBe(200);
    expect(await conns(a.id)).toEqual([]);
    expect(archivistPrompt(sqlite, a.id)!.candidates.map((x) => x.id)).not.toContain(b.id);
  });
  it("a Connection whose kind the owner changed has become theirs: the run's Undo leaves it", async () => {
    const a = await make("source", "Bees and gardens");
    await make("source", "Bees gardens two");
    await look(a.id, { related: [refOf(a.id, "Bees gardens two")] });
    const [c] = await conns(a.id);
    await call("PATCH", `/api/connections/${c.id}`, { kind: "supports", subject: a.id });
    await call("POST", `/api/objects/${a.id}/ai/undo`);
    expect(await conns(a.id)).toMatchObject([{ kind: "supports", origin: "owner" }]);
  });
  it("Ask again adds only new pairs (never a pair already connected) and does not repeat", async () => {
    const a = await make("source", "Bees and gardens");
    await make("source", "Bees gardens two");
    await make("source", "Bees gardens three");
    await look(a.id, { related: [refOf(a.id, "Bees gardens two")] });
    await look(a.id, { related: [refOf(a.id, "Bees gardens three")] });
    expect((await conns(a.id)).map((c: any) => c.other.title).sort()).toEqual(["Bees gardens three", "Bees gardens two"]);
  });
  it("adds 'authored by' for a Person already in the Garden, directly", async () => {
    const ada = await make("person", "Ada Green");
    const src = await make("source", "A book");
    await look(src.id, { people: [{ name: "ada green", central: false }] });
    expect(await conns(src.id)).toMatchObject([{ label: "authored by", origin: "ai", approved: false, other: { id: ada.id } }]);
    expect((await sugg(src.id)).pending).toEqual([]);
  });
  it("never connects a Private Object, and never reads or adds to one", async () => {
    const a = await make("source", "Bees and gardens");
    await make("source", "Bees gardens secret", { private: true });
    await look(a.id, { related: ["c1", "c2"] });
    expect(await conns(a.id)).toEqual([]);
    const priv = await make("source", "Bees private", { private: true });
    const n = sent.length;
    await call("POST", `/api/objects/${priv.id}/ai/run`);
    await ai.tick();
    expect(sent.length).toBe(n);
  });
  it("still never creates an Object, changes a type or writes a Thought: those wait as Suggestions", async () => {
    const src = await make("source", "Ada Green");
    await look(src.id, { type: "person", people: [{ name: "Central Figure", central: true }] });
    expect((await sugg(src.id)).pending.map((p: any) => p.kind).sort()).toEqual(["object", "type"]);
    expect((await call("GET", `/api/objects/${src.id}`)).json.type).toBe("source");
    expect((await call("GET", "/api/objects?type=person")).json).toHaveLength(0);
  });
  it("specific kinds stay Suggestions that wait; Approve makes them real and keeps AI Origin (✧)", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    const sid = seedWaiting(a.id, b.id, "supports");
    const [s] = (await sugg(a.id)).pending;
    expect(s).toMatchObject({ id: sid, kind: "connection", connectionKind: "supports", approved: false });
    expect(await conns(a.id)).toEqual([]);
    expect((await call("POST", `/api/suggestions/${sid}/approve`)).status).toBe(200);
    expect(await conns(a.id)).toMatchObject([{ kind: "supports", origin: "ai", approved: true }]);
    expect((await call("POST", `/api/connections/${(await conns(a.id))[0].id}/undo-ai`)).status).toBe(404); // approved: the owner's to remove, not an AI undo
  });
  it("choosing another kind afterwards makes the Connection the owner's", async () => {
    const a = await make("source", "Bees and gardens");
    await make("source", "Bees gardens two");
    await look(a.id, { related: [refOf(a.id, "Bees gardens two")] });
    const c = (await conns(a.id))[0];
    await call("PATCH", `/api/connections/${c.id}`, { kind: "supports", subject: a.id });
    expect((await conns(a.id))[0]).toMatchObject({ origin: "owner", approved: false, kind: "supports" });
  });
  it("Ask again replaces what the Archivist left waiting (a specific kind) and uses one call", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    seedWaiting(a.id, b.id, "builds on");
    await look(a.id, { related: [] });
    expect(sent).toHaveLength(1);
    expect((await sugg(a.id)).pending).toEqual([]);
  });
  it("Connections waiting from before (related / authored by) are applied once, marked and undoable; specific kinds and the Researcher's keep waiting", async () => {
    const { applyWaitingConnections } = await import("../src/server/suggestions.ts");
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    const c = await make("source", "Bees gardens three");
    const d = await make("source", "Bees gardens four");
    seedWaiting(a.id, b.id, "related");
    seedWaiting(a.id, c.id, "supports");
    seedWaiting(a.id, d.id, "related", "Researcher");
    expect(applyWaitingConnections(sqlite)).toBe(1);
    expect(applyWaitingConnections(sqlite)).toBe(0);
    expect(await conns(a.id)).toMatchObject([{ other: { id: b.id }, origin: "ai", approved: false }]);
    expect((await sugg(a.id)).pending.map((p: any) => p.connectionKind).sort()).toEqual(["related", "supports"]);
    expect((await call("GET", `/api/objects/${a.id}/ai`)).json.run.connections).toBe(1);
    await call("POST", `/api/objects/${a.id}/ai/undo`);
    expect(await conns(a.id)).toEqual([]);
  });
});

describe("Suggestions from the Archivist", () => {
  it("proposes a new Person only when central or named on two Sources, never from a one-off mention", async () => {
    const one = await make("source", "First");
    await look(one.id, { people: [{ name: "Passing Name", central: false }] });
    expect((await sugg(one.id)).pending).toEqual([]);
    await look(one.id, { people: [{ name: "Central Figure", central: true }] });
    expect((await sugg(one.id)).pending).toMatchObject([{ kind: "object", type: "person", name: "Central Figure" }]);
    // named on a second Source
    const two = await make("source", "Second");
    await setFields(two.id, { authors: "Rae Fern" });
    const three = await make("source", "Third");
    await look(three.id, { people: [{ name: "Rae Fern", central: false }] });
    expect((await sugg(three.id)).pending).toMatchObject([{ kind: "object", name: "Rae Fern" }]);
    // Approve makes the Person (AI Origin, approved) and connects the Source to them
    await call("POST", `/api/suggestions/${(await sugg(three.id)).pending[0].id}/approve`);
    const people = (await call("GET", "/api/objects?type=person")).json;
    expect(people).toHaveLength(1);
    expect(people[0].fields.find((f: any) => f.key === "title")).toMatchObject({ value: "Rae Fern", origin: "ai", approved: true });
    expect(people[0].unreviewed).toBe(false);
    expect((await call("GET", `/api/objects/${three.id}/connections`)).json[0]).toMatchObject({ label: "authored by", approved: true });
  });
  it("a changed Object Type is only a Suggestion, and Approve keeps it AI's until the owner changes it", async () => {
    const src = await make("source", "Ada Green");
    await look(src.id, { type: "person" });
    const [s] = (await sugg(src.id)).pending;
    expect(s).toMatchObject({ kind: "type", type: "person", typeLabel: "Person" });
    expect((await call("GET", `/api/objects/${src.id}`)).json.type).toBe("source");
    const obj = (await call("POST", `/api/suggestions/${s.id}/approve`)).json;
    expect(obj.type).toBe("person");
    expect(obj.typeAi).toMatchObject({ aiRole: "Archivist" });
    expect((await call("PATCH", `/api/objects/${src.id}`, { type: "source" })).json.typeAi).toBeNull();
  });
  it("only ever offers a title on a Thought; type, Connections and people are ignored", async () => {
    const other = await make("source", "Soil and gardens");
    const th = (await call("POST", "/api/capture", { text: "Soil and gardens, what I think about gardens" })).json.created[0].id;
    await look(th, { thoughtTitle: "On soil", type: "source", related: ["c1"], people: [{ name: "X Y", central: true }], summary: "AI summary" });
    const s = await sugg(th);
    expect(s.pending).toMatchObject([{ kind: "title", title: "On soil" }]);
    expect(await notes(th)).toEqual([]);
    expect(other.id).toBeTruthy();
    const before = (await call("GET", `/api/objects/${th}`)).json;
    expect(before.fields.find((f: any) => f.key === "title")).toBeUndefined();
    const after = (await call("POST", `/api/suggestions/${s.pending[0].id}/approve`)).json;
    expect(after.fields.find((f: any) => f.key === "title")).toMatchObject({ value: "On soil", origin: "ai", approved: true });
    // editing the title makes it the owner's
    const edited = (await setFields(th, { title: "On soil, my way" })).json;
    expect(edited.fields.find((f: any) => f.key === "title")).toMatchObject({ origin: "owner", approved: false });
    // a rejected title is not proposed again
    const th2 = (await call("POST", "/api/capture", { text: "another" })).json.created[0].id;
    await look(th2, { thoughtTitle: "Nope" });
    await call("POST", `/api/suggestions/${(await sugg(th2)).pending[0].id}/reject`);
    await look(th2, { thoughtTitle: "nope" });
    expect((await sugg(th2)).pending).toEqual([]);
  });
  it("never suggests a Connection into a Thought, or to a Private Object, even if the model names one", async () => {
    const src = await make("source", "Gardens");
    await make("source", "Gardens private", { private: true });
    const th = await make("thought");
    await setFields(th.id, { title: "Gardens thought" });
    await look(src.id, { related: ["c1", "c2", "c3"] });
    expect((await sugg(src.id)).pending).toEqual([]);
  });
});

describe("AI Notes", () => {
  it("a summary of a Source is kept beside the body as an AI Note, never inside it", async () => {
    const src = await make("source", "Soil");
    await call("PUT", `/api/objects/${src.id}/body`, { paragraphs: ["my own words"] });
    await look(src.id, { summary: "This article explains how soil keeps gardens alive." });
    const [n] = await notes(src.id);
    expect(n).toMatchObject({ kind: "summary", origin: "ai", aiRole: "Archivist", text: "This article explains how soil keeps gardens alive." });
    const obj = (await call("GET", `/api/objects/${src.id}`)).json;
    expect(obj.blocks.map((b: any) => b.text)).toEqual(["my own words"]);
    // a fresh run replaces the Archivist's old summary
    await look(src.id, { summary: "A newer summary." });
    expect((await notes(src.id)).map((x: any) => x.text)).toEqual(["A newer summary."]);
  });
  it("can be deleted (and put back), and cannot be edited into the owner's words", async () => {
    const src = await make("source", "Soil");
    await look(src.id, { summary: "A summary." });
    const [n] = await notes(src.id);
    // there is no way to change a note
    expect((await call("PATCH", `/api/ai-notes/${n.id}`, { text: "mine now" })).status).toBe(404);
    expect((await call("PUT", `/api/ai-notes/${n.id}`, { text: "mine now" })).status).toBe(404);
    const gone = (await call("DELETE", `/api/ai-notes/${n.id}`)).json;
    expect(await notes(src.id)).toEqual([]);
    await call("POST", "/api/ai-notes/restore", gone.was);
    expect(await notes(src.id)).toMatchObject([{ text: "A summary.", origin: "ai", aiModel: n.aiModel, aiDate: n.aiDate }]);
  });
  it("'Start a Thought from this' makes an empty Thought with the note attached and an 'inspired by' Connection", async () => {
    const src = await make("source", "Soil");
    await look(src.id, { summary: "A summary." });
    const [n] = await notes(src.id);
    const th = (await call("POST", `/api/ai-notes/${n.id}/thought`)).json;
    expect(th.type).toBe("thought");
    expect(th.blocks).toEqual([]); // empty: room for the owner's own words
    expect(th.unreviewed).toBe(false);
    expect(await notes(th.id)).toMatchObject([{ kind: "prompt", text: "A summary.", origin: "ai", aiRole: "Archivist" }]);
    const c = (await call("GET", `/api/objects/${th.id}/connections`)).json;
    expect(c).toMatchObject([{ kind: "inspired by", label: "inspired by", origin: "owner", other: { id: src.id } }]);
    expect((await call("GET", `/api/objects/${src.id}/connections`)).json[0].label).toBe("inspired");
    // the Thought's body is still only what the owner writes
    const written = (await call("PUT", `/api/objects/${th.id}/body`, { paragraphs: ["my reply"] })).json;
    expect(written.blocks.map((b: any) => [b.text, b.origin])).toEqual([["my reply", "owner"]]);
  });
  it("is not given to a Thought's own prompt, and the summary needs a Source", async () => {
    const th = (await call("POST", "/api/capture", { text: "plain" })).json.created[0].id;
    await look(th, { summary: "Nope" });
    expect(await notes(th)).toEqual([]);
  });
});

describe("Making an Object Private", () => {
  it("drops pending Suggestions (also those pointing at it), deletes its AI Notes, keeps approved items, and says when", async () => {
    const a = await make("source", "Bees and gardens");
    const b = await make("source", "Bees gardens two");
    const c = await make("source", "Bees gardens three");
    await look(a.id, { summary: "A summary." });
    seedWaiting(a.id, b.id, "supports");
    await call("POST", `/api/suggestions/${seedWaiting(a.id, c.id, "supports")}/approve`); // approved: stays
    // Private on the other end drops the one pointing at it
    await call("PATCH", `/api/objects/${b.id}`, { private: true });
    expect((await sugg(a.id)).pending).toEqual([]);
    // Private on this Object deletes its AI Notes
    expect(await notes(a.id)).toHaveLength(1);
    const priv = (await call("PATCH", `/api/objects/${a.id}`, { private: true })).json;
    expect(await notes(a.id)).toEqual([]);
    expect(priv.aiReadBeforePrivate).toBe(new Date().toISOString().slice(0, 10));
    expect((await call("GET", `/api/objects/${a.id}/connections`)).json).toHaveLength(1); // approved Connection stays
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_suggestions").get()).toEqual({ n: 0 });
  });
  it("only says 'AI read this before' when the AI really had; a never-read Object just says Private", async () => {
    const fresh = await make("source", "Never read");
    expect((await call("PATCH", `/api/objects/${fresh.id}`, { private: true })).json.aiReadBeforePrivate).toBeNull();
    const read = await make("source", "Read");
    await look(read.id, { tags: ["x"] });
    expect((await call("PATCH", `/api/objects/${read.id}`, { private: true })).json.aiReadBeforePrivate).toBeTruthy();
  });
  it("shows no Suggestions and no notes for a Private Object, and turning it off starts nothing by itself", async () => {
    const a = await make("source", "Bees");
    await look(a.id, { summary: "S." });
    await call("PATCH", `/api/objects/${a.id}`, { private: true });
    expect(await sugg(a.id)).toEqual({ pending: [], rejected: 0 });
    const off = (await call("PATCH", `/api/objects/${a.id}`, { private: false })).json;
    expect(off.aiReadBeforePrivate).toBeNull();
    const calls = sent.length;
    clock = new Date(clock.getTime() + 600_000);
    await ai.tick();
    expect(sent.length).toBe(calls);
    expect(await notes(a.id)).toEqual([]);
  });
  it("does not write a Suggestion or note if the Object became Private while the AI was thinking", async () => {
    const a = await make("source", "Bees");
    const slow = (async (...args: any[]) => { sqlite.prepare("UPDATE objects SET private = 1 WHERE id = ?").run(a.id); return (fakeFetch as any)(...args); }) as unknown as typeof fetch;
    ai = createAi(sqlite, { gate: createGate({ fetch: slow, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
    reply({ summary: "S.", thoughtTitle: "T", type: "person" });
    ai.request(a.id);
    clock = new Date(clock.getTime() + 10_000);
    await ai.tick();
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_notes").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_suggestions").get()).toEqual({ n: 0 });
  });
});
