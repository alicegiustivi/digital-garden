import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-researcher-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate } = await import("../src/server/ai-gate.ts");
const { createAi } = await import("../src/server/ai-queue.ts");
const { AI_CONFIG } = await import("../src/server/ai-config.ts");

// A pretend OpenRouter. Each call takes the next scripted reply; every request is kept so tests can read what was sent.
type Reply = { status?: number; content?: string };
let replies: Reply[], sent: { body: any }[], clock: Date;
const fakeFetch = (async (_url: string, init: any) => {
  sent.push({ body: JSON.parse(init.body) });
  const r = replies.shift() ?? { content: "{}" };
  return new Response(JSON.stringify({ choices: [{ message: { content: r.content ?? "{}" } }] }), { status: r.status ?? 200 });
}) as unknown as typeof fetch;
const json = (j: object): Reply => ({ content: JSON.stringify(j) });
const busy: Reply = { status: 503 };

let sqlite: ReturnType<typeof openDb>["sqlite"], ai: ReturnType<typeof createAi>, app: ReturnType<typeof createApp>;
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  replies = []; sent = []; clock = new Date("2026-11-07T10:00:00Z");
  ai = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
  app = createApp(sqlite, { readLink: () => {}, ai });
});
const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
/** An Object with a title and some text of the given Origin. */
const make = async (type: string, title: string, text = "", opts: { origin?: "owner" | "source"; private?: boolean; tag?: string } = {}) => {
  const id = (await call("POST", "/api/objects", { type, title })).json.id as string;
  if (text) {
    sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, 0, ?, ?)").run(id, text, opts.origin ?? "owner");
  }
  if (opts.tag) await call("POST", `/api/objects/${id}/tags`, { name: opts.tag });
  if (opts.private) await call("PATCH", `/api/objects/${id}`, { private: true });
  return id;
};
const ask = async (question: string, objectId?: string) => (await call("POST", "/api/inquiries", { question, objectId })).json;
const run = async () => { later(0.2); return ai.tick(); }; // 6 seconds between calls
const thread = async (id: string) => (await call("GET", `/api/inquiries/${id}`)).json;
const promptOf = (n: number) => JSON.stringify(sent[n].body.messages);

describe("asking", () => {
  it("saves the question first, in lane 0, and answers in two requests with real links only", async () => {
    const a = await make("source", "Walking Notes", "Walking helps me think.", { origin: "owner", tag: "walking" });
    const b = await make("source", "Sleep Book", "Sleep matters.", { origin: "source" });
    const inq = await ask("What do I know about walking?");
    expect(inq.turns[0]).toMatchObject({ state: "waiting", question: "What do I know about walking?" });
    expect(sqlite.prepare("SELECT lane, role FROM ai_jobs WHERE turn_id = ?").get(inq.turns[0].id)).toEqual({ lane: 0, role: "researcher" });

    replies.push(json({ read: ["o1", "o2", "o99"] }));
    replies.push(json({ answer: "You wrote that walking helps [o1]. A made-up link [o77] and [[o:00000000-0000-0000-0000-000000000000]] go.", connections: [] }));
    expect(await run()).toBe(true);
    expect(sent).toHaveLength(2); // exactly two requests, no embeddings
    const t = (await thread(inq.id)).turns[0];
    expect(t.state).toBe("done");
    expect(t.steps.every((s: any) => s.done)).toBe(true);
    expect(t.answer.text).not.toContain("o77");
    expect(t.answer.text).not.toContain("00000000-0000");
    expect(t.answer.text).toMatch(/\[\[o:[0-9a-f-]{36}\]\]/);
    expect(t.answer.reads.map((r: any) => r.title).sort()).toEqual(["Sleep Book", "Walking Notes"]);
    expect(t.answer.privateNote).toBeNull();
    expect(t.answer).toMatchObject({ role: "Researcher", date: "2026-11-07" });
    void a; void b;
  });

  it("never shows the AI a Private Object, the Bin, a Mention of one, or any earlier answer", async () => {
    const open = await make("source", "Open Book", "walking and thinking", { origin: "source" });
    const secret = await make("thought", "Secret Walk", "my private walking diary", { private: true });
    const gone = await make("source", "Binned Walk", "walking in the bin");
    await call("DELETE", `/api/objects/${gone}`);
    await call("PUT", `/api/objects/${open}/body`, { paragraphs: [`I walk. [[o:${secret}]]`] });
    const inq = await ask("walking and thinking?");
    replies.push(json({ read: ["o1"] }), json({ answer: "Nothing private here.", connections: [] }));
    await run();
    for (const n of [0, 1]) {
      const p = promptOf(n);
      expect(p).not.toContain("Secret Walk");
      expect(p).not.toContain("private walking diary");
      expect(p).not.toContain("Binned Walk");
      expect(p).not.toContain(secret);
    }
    // an earlier answer is not evidence: a follow-up shows it only as labelled context, and kept AI Notes are never shown
    await call("POST", `/api/turns/${(await thread(inq.id)).turns[0].id}/keep`, { objectIds: [open] });
    replies.push(json({ read: ["o1"] }), json({ answer: "Still nothing.", connections: [] }));
    await call("POST", `/api/inquiries/${inq.id}/turns`, { question: "and sleep?" });
    await run();
    expect(promptOf(2)).not.toContain("Nothing private here"); // the picking request sees cards only
    expect(promptOf(3)).toContain("NOT evidence");
    expect(promptOf(3)).not.toContain("kept");
  });

  it("the Garden adds the Private line, with a count, and the AI is never told", async () => {
    await make("source", "Walking Book", "walking helps thinking", { origin: "source" });
    for (const t of ["Walk one", "Walk two", "Walk three"]) await make("thought", t, "walking helps thinking a lot", { private: true });
    const inq = await ask("How does walking help thinking?");
    replies.push(json({ read: ["o1"] }), json({ answer: "It helps [o1].", connections: [] }));
    await run();
    const t = (await thread(inq.id)).turns[0];
    expect(t.answer.privateNote).toBe("3 Private Objects match this. The Researcher didn't read them.");
    expect(promptOf(1)).not.toMatch(/Private/i);
  });

  it("refuses to ask about a Private Object, and skips one that turns Private while it waits", async () => {
    const id = await make("source", "Diary", "words", { origin: "source" });
    const q = await ask("What is in here?", id);
    await call("PATCH", `/api/objects/${id}`, { private: true });
    expect((await call("POST", "/api/inquiries", { question: "again?", objectId: id })).status).toBe(400);
    await run();
    expect(sent).toHaveLength(0);
    expect((await thread(q.id)).turns[0].error).toMatch(/Private/);
  });

  it("says 'you wrote' only when something the owner wrote was shown (otherwise it asks again)", async () => {
    await make("source", "A Source", "only the source speaks", { origin: "source" });
    const inq = await ask("what does the source say?");
    replies.push(json({ read: ["o1"] }), json({ answer: "You wrote that it speaks.", connections: [] }), json({ answer: "The Source says it speaks [o1].", connections: [] }));
    await run();
    const t = (await thread(inq.id)).turns[0];
    expect(t.answer.text).toMatch(/^The Source says/);
    expect(promptOf(1)).toContain("from the Source");
  });

  it("turns connections it found into Suggestions, never on a Thought, never twice", async () => {
    const a = await make("source", "Alpha Study", "alpha says yes", { origin: "source" });
    const b = await make("source", "Beta Study", "beta says no", { origin: "source" });
    const th = await make("thought", "My thought", "alpha and beta");
    const inq = await ask("alpha and beta study?");
    replies.push(json({ read: ["o1", "o2", "o3"] }), json({
      answer: "They differ [o2] [o3].",
      connections: [{ a: "o2", b: "o3", kind: "contradicts" }, { a: "o2", b: "o1", kind: "related" }, { a: "o3", b: "o2", kind: "related" }, { a: "o2", b: "o3", kind: "bogus" }],
    }));
    await run();
    const rows = sqlite.prepare("SELECT object_id, ai_role, data FROM ai_suggestions").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].ai_role).toBe("Researcher");
    expect(JSON.parse(rows[0].data).kind).toBe("contradicts");
    expect(rows.every((r) => r.object_id !== th)).toBe(true);
    const sug = (await call("GET", `/api/objects/${rows[0].object_id}/suggestions`)).json;
    expect(sug.pending).toHaveLength(1);
    await call("POST", `/api/suggestions/${sug.pending[0].id}/approve`);
    expect(sqlite.prepare("SELECT kind, origin FROM connections WHERE kind = 'contradicts'").get()).toEqual({ kind: "contradicts", origin: "ai" });
    void a; void b; void inq;
  });
});

describe("keeping answers", () => {
  const answered = async () => {
    const a = await make("source", "Walking Notes", "Walking helps me think.", { origin: "owner" });
    const inq = await ask("walking?", a);
    replies.push(json({ read: [], }), json({ answer: "It helps [o1].", connections: [] }));
    await run();
    return { a, inq, turn: (await thread(inq.id)).turns[0] };
  };
  it("an answer reaches an Object only through Keep, never a Private one; deleting the Inquiry keeps it with a link back", async () => {
    const { a, inq, turn } = await answered();
    expect((await call("GET", `/api/objects/${a}/ai-notes`)).json).toHaveLength(0);
    const other = await make("source", "Other", "x");
    const priv = await make("source", "Hidden", "x", { private: true });
    expect((await call("POST", `/api/turns/${turn.id}/keep`, { objectIds: [priv] })).status).toBe(400);
    expect((await call("POST", `/api/turns/${turn.id}/keep`, { objectIds: [a, other, a] })).status).toBe(200);
    const notes = (await call("GET", `/api/objects/${a}/ai-notes`)).json;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "answer", origin: "ai", aiRole: "Researcher", from: { id: inq.id, question: "walking?", state: "here" } });
    // deleting the Inquiry: the kept answer stays and still says where it came from
    await call("DELETE", `/api/inquiries/${inq.id}`);
    expect((await call("GET", `/api/inquiries/${inq.id}`)).status).toBe(404);
    expect((await call("GET", `/api/objects/${a}/ai-notes`)).json[0].from).toMatchObject({ state: "bin", question: "walking?" });
    await call("POST", "/api/bin/empty");
    expect((await call("GET", `/api/objects/${other}/ai-notes`)).json[0]).toMatchObject({ kind: "answer", from: { state: "gone", question: "walking?" } });
  });
  it("Start a Thought from an answer makes an empty Thought with the answer beside it, and the answer can't become the owner's words", async () => {
    const { a, turn } = await answered();
    const { json: t } = await call("POST", `/api/turns/${turn.id}/thought`);
    const obj = (await call("GET", `/api/objects/${t.id}`)).json;
    expect(obj.type).toBe("thought");
    expect(obj.blocks).toHaveLength(0);
    const notes = (await call("GET", `/api/objects/${t.id}/ai-notes`)).json;
    expect(notes[0]).toMatchObject({ kind: "prompt", origin: "ai" });
    expect(sqlite.prepare("SELECT kind FROM connections WHERE from_id = ? AND to_id = ?").get(t.id, a)).toEqual({ kind: "inspired by" });
  });
  it("a Private Object's kept answers go away when it becomes Private", async () => {
    const { a, turn } = await answered();
    await call("POST", `/api/turns/${turn.id}/keep`, { objectIds: [a] });
    await call("PATCH", `/api/objects/${a}`, { private: true });
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_notes WHERE object_id = ?").get(a)).toEqual({ n: 0 });
  });
});

describe("a busy or used-up free AI", () => {
  it("saves the question, retries for about an hour, then says so; Cancel works", async () => {
    await make("source", "Walking Notes", "Walking helps me think.", { origin: "owner" });
    const inq = await ask("walking?");
    const tid = inq.turns[0].id;
    const state = async () => (await thread(inq.id)).turns[0];
    // every model busy on the first request
    replies.push(busy, busy);
    await run();
    let t = await state();
    expect(t.state).toBe("busy");
    expect(t.tries).toBe(1);
    const waits: number[] = [];
    for (let i = 0; i < 3; i++) {
      const at = Date.parse(t.nextTryAt);
      waits.push(Math.round((at - clock.getTime()) / 60_000));
      clock = new Date(at);
      replies.push(busy, busy);
      await ai.tick();
      t = await state();
    }
    expect(waits).toEqual([1, 5, 15]);
    expect(t.state).toBe("busy");
    const last = Date.parse(t.nextTryAt);
    clock = new Date(last); replies.push(busy, busy); await ai.tick();
    t = await state();
    expect(t.state).toBe("failed");
    expect(t.error).toMatch(/about an hour/);
    // ask again, then cancel
    await call("POST", `/api/turns/${tid}/retry`);
    expect((await state()).state).toBe("waiting");
    expect((await call("POST", `/api/turns/${tid}/cancel`)).json.cancelled).toBe(true);
    expect((await state()).state).toBe("cancelled");
    sent.length = 0; later(5);
    await ai.tick();
    expect(sent).toHaveLength(0);
  });
  it("a busy second request keeps the first request's choice and only asks again for the answer", async () => {
    await make("source", "Walking Notes", "Walking helps me think.", { origin: "owner" });
    const inq = await ask("walking?");
    replies.push(json({ read: ["o1"] }), busy, busy);
    await run();
    expect((await thread(inq.id)).turns[0].state).toBe("busy");
    sent.length = 0;
    clock = new Date(clock.getTime() + 2 * 60_000);
    replies.push(json({ answer: "Yes [o1].", connections: [] }));
    await ai.tick();
    expect(sent).toHaveLength(1);
    expect((await thread(inq.id)).turns[0].state).toBe("done");
  });
  it("after the daily limit a question waits for the reset", async () => {
    sqlite.prepare("INSERT INTO ai_usage (day, role, calls) VALUES ('2026-11-07', 'researcher', ?)").run(AI_CONFIG.dailyCalls.researcher);
    const inq = await ask("anything?");
    await run();
    const t = (await thread(inq.id)).turns[0];
    expect(t.state).toBe("tomorrow");
    expect(t.nextTryAt).toBe("2026-11-08T00:00:00.000Z");
    expect(sent).toHaveLength(0);
  });
  it("a waiting question goes ahead of the Archivist's work", async () => {
    const cap = await call("POST", "/api/capture", { text: "something captured" });
    ai.flushCaptures();
    const inq = await ask("anything?");
    await make("source", "S", "x");
    replies.push(json({ read: [] }), json({ answer: "Nothing.", connections: [] }));
    await run();
    expect((await thread(inq.id)).turns[0].state).toBe("done");
    expect(sqlite.prepare("SELECT status FROM ai_jobs WHERE role = 'archivist'").get()).toMatchObject({ status: "waiting" });
    void cap;
  });
  it("warns before the day's calls run out, with a threshold that fits a 1,000-call limit", () => {
    expect(AI_CONFIG.lowCallsWarning).toBeGreaterThan(50);
    expect(ai.summary().low).toBe(false);
    sqlite.prepare("INSERT INTO ai_usage (day, role, calls) VALUES ('2026-11-07', 'researcher', ?)").run(AI_CONFIG.dailyCalls.researcher - 20);
    sqlite.prepare("INSERT INTO ai_usage (day, role, calls) VALUES ('2026-11-07', 'archivist', ?)").run(AI_CONFIG.dailyCalls.archivist - 20);
    expect(ai.summary().low).toBe(true);
  });
});

describe("Ask about one Object", () => {
  it("reads the Object in full plus connected ones, and lists the Inquiries about it", async () => {
    const c = await make("concept", "Walking", "My view on walking.", { origin: "owner" });
    const s = await make("source", "A Walk Book", "Chapter text about legs.", { origin: "source" });
    await make("source", "Unrelated Cooking", "pasta", { origin: "source" });
    await call("POST", "/api/connections", { a: c, b: s });
    const inq = await ask("What here disagrees?", c);
    replies.push(json({ read: ["o1"] }), json({ answer: "Nothing disagrees [o0] [o1].", connections: [] }));
    await run();
    expect(promptOf(0)).toContain("A Walk Book");
    expect(promptOf(0)).not.toContain("Unrelated Cooking");
    expect(promptOf(1)).toContain("My view on walking.");
    expect(promptOf(1)).toContain("the owner's words");
    const list = (await call("GET", `/api/objects/${c}/inquiries`)).json;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: inq.id, question: "What here disagrees?" });
    expect((await call("GET", "/api/inquiries")).json).toHaveLength(1);
  });
});
