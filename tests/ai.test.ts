import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-ai-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate, GateError } = await import("../src/server/ai-gate.ts");
const { createAi, retryDelayMinutes } = await import("../src/server/ai-queue.ts");
const { AI_CONFIG } = await import("../src/server/ai-config.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");

// A pretend OpenRouter: each call takes the next scripted reply, and every request is kept so tests can read what was sent.
type Reply = { status?: number; headers?: Record<string, string>; content?: string; body?: unknown };
let replies: Reply[], sent: { url: string; body: any }[], clock: Date;
const fakeFetch = (async (url: string, init: any) => {
  sent.push({ url, body: init?.body ? JSON.parse(init.body) : null });
  const r = replies.shift() ?? { content: '{"tags":[]}' };
  const body = r.body ?? { choices: [{ message: { content: r.content ?? '{"tags":[]}' } }] };
  return new Response(JSON.stringify(body), { status: r.status ?? 200, headers: r.headers });
}) as unknown as typeof fetch;
const findings = (j: object) => ({ content: JSON.stringify(j) });

let sqlite: ReturnType<typeof openDb>["sqlite"];
let ai: ReturnType<typeof createAi>;
let app: ReturnType<typeof createApp>;
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
const capture = async (body: object) => (await call("POST", "/api/capture", body)).json;
const field = (id: string, f: string) => sqlite.prepare("SELECT * FROM field_values WHERE object_id = ? AND field = ?").get(id, f) as any;
const tagsOf = (id: string) => sqlite.prepare("SELECT t.name, ot.origin FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE object_id = ? ORDER BY t.name").all(id) as any[];
const jobs = () => sqlite.prepare("SELECT * FROM ai_jobs ORDER BY id").all() as any[];
const link = "https://example.com/a-book-about-gardens";
const newSource = async () => {
  const id = (await capture({ links: [link], text: "my words" })).created[0].id as string;
  sqlite.prepare("UPDATE field_values SET value = 'extracted' WHERE object_id = ? AND field = 'extraction'").run(id); // the page has been read
  return id;
};

describe("the AI gate", () => {
  it("refuses any model that does not end in :free, and sends nothing", async () => {
    const gate = createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" });
    for (const m of ["openai/gpt-4o", "nvidia/nemotron-3.5-super-vl", "x/y:free-not", "a/b:free:paid", ""]) {
      await expect(gate.chat(m, [{ role: "user", content: "hi" }])).rejects.toMatchObject({ kind: "refused" });
    }
    expect(sent).toHaveLength(0);
    replies.push({ content: "ok" });
    await expect(gate.chat("nvidia/nemotron-3.5-super-vl:free", [{ role: "user", content: "hi" }])).resolves.toBe("ok");
  });
  it("only has free models in its one config setting: the vision model first, then the text one", () => {
    expect(AI_CONFIG.models).toEqual(["nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-ultra-550b-a55b:free"]);
    for (const m of AI_CONFIG.models) expect(m.endsWith(":free")).toBe(true);
  });
  it("says busy for a busy model, daily when the day's count is gone, key for a wrong key", async () => {
    const gate = createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" });
    const m = "nvidia/nemotron-3.5-super-vl:free", msg = [{ role: "user" as const, content: "x" }];
    replies.push({ status: 429, body: { error: { message: "Rate limit exceeded" } } });
    await expect(gate.chat(m, msg)).rejects.toMatchObject({ kind: "busy" });
    replies.push({ status: 503, body: {} });
    await expect(gate.chat(m, msg)).rejects.toMatchObject({ kind: "busy" });
    replies.push({ status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1794009600000" }, body: { error: { message: "limit" } } });
    await expect(gate.chat(m, msg)).rejects.toMatchObject({ kind: "daily", resetAt: 1794009600000 });
    replies.push({ status: 401, body: {} });
    await expect(gate.chat(m, msg)).rejects.toMatchObject({ kind: "key" });
  });
  it("says missing, without calling out, when there is no key", async () => {
    const gate = createGate({ fetch: fakeFetch, key: () => null, baseUrl: "http://pretend" });
    await expect(gate.chat("a/b:free", [])).rejects.toBeInstanceOf(GateError);
    expect(sent).toHaveLength(0);
  });
});

describe("Private never reaches the AI", () => {
  it("builds no prompt for a Private or binned Object", async () => {
    const t = (await capture({ text: "secret diary", private: true })).created[0].id;
    expect(archivistPrompt(sqlite, t)).toBeNull();
    const open = (await capture({ text: "open thought" })).created[0].id;
    expect(archivistPrompt(sqlite, open)).not.toBeNull();
    await call("DELETE", `/api/objects/${open}`);
    expect(archivistPrompt(sqlite, open)).toBeNull();
  });
  it("never queues a Private capture", async () => {
    await capture({ text: "secret diary", private: true });
    expect(jobs()).toHaveLength(0);
  });
  it("cuts a Mention of a Private Object out of another Object's prompt, with its title, Tags and text", async () => {
    const priv = (await call("POST", "/api/objects", { type: "person", title: "Zebediah Quill", private: true })).json;
    await call("PUT", `/api/objects/${priv.id}/body`, { paragraphs: ["quill-secret-body"] });
    await call("POST", `/api/objects/${priv.id}/tags`, { name: "quill-only-tag" });
    const open = (await call("POST", "/api/objects", { type: "person", title: "Open Person" })).json;
    const th = (await capture({ text: "I met someone." })).created[0].id;
    await call("PUT", `/api/objects/${th}/body`, { paragraphs: ["I met someone.", `[[o:${priv.id}]]`, `and ${`[[o:${open.id}]]`} too`] });
    const p = JSON.stringify(archivistPrompt(sqlite, th));
    expect(p).toContain("I met someone.");
    expect(p).toContain("Open Person"); // a readable Mention is named
    for (const leak of [priv.id, "Zebediah", "quill-secret-body", "quill-only-tag"]) expect(p).not.toContain(leak);
  });
  it("sends nothing out when an Object is made Private after it was queued", async () => {
    const id = await newSource();
    await call("PATCH", `/api/objects/${id}`, { private: true });
    later(5);
    await ai.tick();
    expect(sent).toHaveLength(0);
    expect((await call("GET", `/api/objects/${id}/ai`)).json.state).toBe("private");
  });
  it("does not write anything if an Object became Private while the AI was thinking", async () => {
    const id = await newSource();
    later(5);
    replies.push({ content: JSON.stringify({ tags: ["late"] }) });
    const orig = fakeFetch;
    const slow = (async (...a: any[]) => { sqlite.prepare("UPDATE objects SET private = 1 WHERE id = ?").run(id); return (orig as any)(...a); }) as unknown as typeof fetch;
    ai = createAi(sqlite, { gate: createGate({ fetch: slow, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
    await ai.tick();
    expect(tagsOf(id)).toEqual([]);
  });
});

describe("the Archivist", () => {
  it("waits about 2 minutes after a capture, or until the Capture window closes", async () => {
    await newSource();
    expect(await ai.tick()).toBe(false);
    later(1);
    expect(await ai.tick()).toBe(false);
    later(1.1);
    expect(await ai.tick()).toBe(true);
    // Closing the window releases it at once
    const other = (await capture({ text: "another thought" })).created[0].id;
    later(0.5);
    expect(await ai.tick()).toBe(false);
    await call("POST", "/api/ai/flush");
    later(0.2);
    expect(await ai.tick()).toBe(true);
    expect(other).toBeTruthy();
  });

  it("saves the content first, then adds marked, undoable AI contributions", async () => {
    const id = await newSource();
    expect(jobs()[0].created_at).toBeTruthy();
    expect(sqlite.prepare("SELECT text FROM blocks WHERE object_id = ?").get(id)).toMatchObject({ text: "my words" }); // already there, before any AI
    later(3);
    replies.push(findings({ format: "book", title: "A Book About Gardens", authors: "Ada Green", published: "2019", tags: ["Gardening", "slow living"] }));
    await ai.tick();
    const obj = (await call("GET", `/api/objects/${id}`)).json;
    const f = (k: string) => obj.fields.find((x: any) => x.key === k);
    expect(f("title")).toMatchObject({ value: "A Book About Gardens", origin: "ai", aiRole: "Archivist", aiModel: AI_CONFIG.models[0] });
    expect(f("format")).toMatchObject({ value: "book", origin: "ai" });
    expect(f("authors")).toMatchObject({ value: "Ada Green", origin: "ai" });
    expect(obj.tags.map((t: any) => [t.name, t.origin])).toEqual([["gardening", "ai"], ["slow-living", "ai"]]);
    expect(obj.blocks.map((b: any) => [b.text, b.origin])).toEqual([["my words", "owner"]]); // the owner's words untouched
    expect(f("link")).toMatchObject({ origin: "source" });
    const st = (await call("GET", `/api/objects/${id}/ai`)).json;
    expect(st.state).toBe("done");
    expect(st.run.tags).toEqual(["gardening", "slow-living"]);

    // one click undoes all of it, and the original captured values return
    const undone = (await call("POST", `/api/objects/${id}/ai/undo`)).json;
    expect(undone.tags).toEqual([]);
    expect(field(id, "title")).toBeUndefined();
    expect(field(id, "format")).toMatchObject({ value: "web page", origin: "source" });
    expect((await call("GET", `/api/objects/${id}/ai`)).json.run).toBeNull();
  });

  it("never overwrites what the owner wrote, and only tags a Thought", async () => {
    const id = await newSource();
    await call("PATCH", `/api/objects/${id}`, { fields: { title: "My own title", authors: "Me" } });
    const th = (await capture({ text: "a plain thought" })).created[0].id;
    later(3);
    replies.push(findings({ format: "book", title: "AI title", authors: "AI person", published: "2001", tags: ["x"] }));
    replies.push(findings({ format: "book", title: "AI title for thought", tags: ["y"] }));
    await ai.tick(); later(1); await ai.tick();
    expect(field(id, "title")).toMatchObject({ value: "My own title", origin: "owner" });
    expect(field(id, "authors")).toMatchObject({ value: "Me", origin: "owner" });
    expect(field(id, "published")).toMatchObject({ value: "2001", origin: "ai" });
    expect(field(th, "title")).toBeUndefined();
    expect(field(th, "format")).toBeUndefined();
    expect(tagsOf(th)).toEqual([{ name: "y", origin: "ai" }]);
  });

  it("does not propose a Tag again once the owner removed it or undid it", async () => {
    const id = await newSource();
    later(3);
    replies.push(findings({ tags: ["keep", "drop"] }));
    await ai.tick();
    const drop = (await call("GET", `/api/objects/${id}`)).json.tags.find((t: any) => t.name === "drop");
    await call("DELETE", `/api/objects/${id}/tags/${drop.id}`);
    await call("POST", `/api/objects/${id}/ai/run`);
    replies.push(findings({ tags: ["drop", "new"] }));
    later(1);
    await ai.tick();
    expect(tagsOf(id).map((t) => t.name)).toEqual(["keep", "new"]);
  });

  it("sends a photo only to the first (vision) model, and waits for it when it is busy", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { imagesDir } = await import("../src/server/paths.ts");
    const id = "11111111-1111-1111-1111-111111111111";
    mkdirSync(imagesDir(), { recursive: true });
    writeFileSync(join(imagesDir(), `${id}.jpg`), Buffer.from("not-really-a-jpeg"));
    sqlite.prepare("INSERT INTO objects (id, type, unreviewed) VALUES (?, 'source', 1)").run(id);
    sqlite.prepare("INSERT INTO source_images (object_id, file, thumb) VALUES (?, ?, ?)").run(id, `${id}.jpg`, `${id}.thumb.jpg`);
    ai.enqueueCaptured([id]);
    later(3);
    replies.push({ status: 503, body: {} }, findings({ tags: ["wrong-model"] }));
    await ai.tick();
    expect(sent.map((s) => s.body.model)).toEqual([AI_CONFIG.visionModels[0]]); // never the text-only model
    expect(sent[0].body.messages[1].content.some((p: any) => p.type === "image_url")).toBe(true);
    expect((await call("GET", `/api/objects/${id}/ai`)).json.state).toBe("busy");
    later(2);
    await ai.tick();
    expect(tagsOf(id)).toEqual([{ name: "wrong-model", origin: "ai" }]);
  });

  it("tries the second model when the first is busy, for text", async () => {
    await newSource();
    later(3);
    replies.push({ status: 429, body: { error: { message: "busy" } } });
    replies.push(findings({ tags: ["ok"] }));
    await ai.tick();
    expect(sent.map((s) => s.body.model)).toEqual(AI_CONFIG.models);
    expect(jobs()[0].status).toBe("done");
  });
});

describe("the queue", () => {
  it("runs owner requests before captures, oldest capture first, and a Researcher question first of all", async () => {
    const a = (await capture({ text: "first" })).created[0].id;
    later(0.1);
    const b = (await capture({ text: "second" })).created[0].id;
    later(0.1);
    const c = (await capture({ text: "third" })).created[0].id;
    later(5);
    ai.request(c); // the owner asks for the third
    const ran: string[] = [];
    ai = createAi(sqlite, {
      gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true,
      handlers: {
        archivist: async (j) => { ran.push(`archivist:${j.object_id}`); return "done"; },
        researcher: async () => { ran.push("researcher"); return "done"; },
      },
    });
    ai.enqueue("researcher", null, 0, clock);
    for (let i = 0; i < 4; i++) { later(1); await ai.tick(); }
    expect(ran).toEqual(["researcher", `archivist:${c}`, `archivist:${a}`, `archivist:${b}`]);
  });

  it("keeps to 300 calls a day for the Archivist and 700 for the Researcher, then waits until tomorrow", async () => {
    expect(AI_CONFIG.dailyCalls).toEqual({ archivist: 300, researcher: 700 });
    const id = (await capture({ text: "x" })).created[0].id;
    sqlite.prepare("INSERT INTO ai_usage (day, role, calls) VALUES ('2026-11-07', 'archivist', 300)").run();
    later(3);
    expect(await ai.tick()).toBe(false);
    expect(sent).toHaveLength(0);
    const st = (await call("GET", `/api/objects/${id}/ai`)).json;
    expect(st.state).toBe("tomorrow");
    expect(st.nextTryAt).toBe("2026-11-08T00:00:00.000Z");
    // The Researcher's own 700 are separate
    expect((await call("GET", "/api/ai")).json.budgets).toEqual({ archivist: { used: 300, limit: 300 }, researcher: { used: 0, limit: 700 } });
    // the next day it carries on
    clock = new Date("2026-11-08T00:01:00Z");
    replies.push(findings({ tags: ["fresh"] }));
    expect(await ai.tick()).toBe(true);
    expect(tagsOf(id)).toEqual([{ name: "fresh", origin: "ai" }]);
  });

  it("retries a busy model after 1, 5, 15, 30 minutes, then hourly, and never calls that a failure", async () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(retryDelayMinutes)).toEqual([1, 5, 15, 30, 60, 60, 60]);
    const id = (await capture({ text: "x" })).created[0].id;
    later(3);
    const seen: string[] = [];
    for (const wait of [1, 5, 15, 30, 60, 60]) {
      replies.push({ status: 503, body: {} }, { status: 503, body: {} });
      expect(await ai.tick()).toBe(true);
      const j = jobs()[0];
      seen.push(`${j.status}:${(Date.parse(j.run_after) - clock.getTime()) / 60_000}`);
      const st = (await call("GET", `/api/objects/${id}/ai`)).json;
      expect(st.state).toBe("busy");
      expect(st.nextTryAt).toBeTruthy();
      later(wait);
    }
    expect(seen).toEqual(["busy:1", "busy:5", "busy:15", "busy:30", "busy:60", "busy:60"]);
    replies.push(findings({ tags: ["finally"] }));
    await ai.tick();
    expect(jobs()[0].status).toBe("done");
  });

  it("shows Couldn't read this with Retry only after the model keeps sending nothing usable; the content is untouched; Retry works", async () => {
    const id = (await capture({ text: "keep me" })).created[0].id;
    for (let i = 0; i < AI_CONFIG.maxUnusable; i++) {
      later(70);
      replies.push({ content: "I think this is lovely!" }, { content: "Nice." });
      await ai.tick();
    }
    const st = (await call("GET", `/api/objects/${id}/ai`)).json;
    expect(st.state).toBe("failed");
    expect(st.canRun).toBe(true);
    expect(sqlite.prepare("SELECT text, origin FROM blocks WHERE object_id = ?").all(id)).toEqual([{ text: "keep me", origin: "owner" }]);
    expect(tagsOf(id)).toEqual([]);
    await call("POST", `/api/objects/${id}/ai/run`);
    replies.push(findings({ tags: ["retried"] }));
    later(1);
    await ai.tick();
    expect((await call("GET", `/api/objects/${id}/ai`)).json.state).toBe("done");
    expect(tagsOf(id)).toEqual([{ name: "retried", origin: "ai" }]);
  });

  it("goes to 'Waiting until tomorrow' when OpenRouter says the day is used up, and records the reset time it was told", async () => {
    const id = (await capture({ text: "x" })).created[0].id;
    later(3);
    const reset = Date.parse("2026-11-08T00:00:00Z");
    replies.push({ status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }, body: { error: { message: "daily" } } });
    replies.push({ status: 429, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }, body: { error: { message: "daily" } } });
    await ai.tick();
    const st = (await call("GET", `/api/objects/${id}/ai`)).json;
    expect(st.state).toBe("tomorrow");
    expect(st.nextTryAt).toBe("2026-11-08T00:00:00.000Z");
    expect((await call("GET", "/api/ai")).json.reset).toMatchObject({ at: "2026-11-08T00:00:00.000Z", source: expect.stringContaining("OpenRouter") });
    later(5);
    expect(await ai.tick()).toBe(false); // nothing more is sent today
  });

  it("just leaves work queued when the Mac is off, and a call interrupted by shutdown starts over", async () => {
    const id = (await capture({ text: "x" })).created[0].id;
    sqlite.prepare("UPDATE ai_jobs SET status = 'working'").run();
    const again = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => clock, hasKey: () => true });
    expect(jobs()[0].status).toBe("waiting");
    expect((await call("GET", `/api/objects/${id}/ai`)).json.state).toBe("waiting");
    expect(again).toBeTruthy();
  });

  it("holds work, without sending anything, when there is no key; and says so", async () => {
    const id = (await capture({ text: "x" })).created[0].id;
    const keyless = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => null, baseUrl: "http://pretend" }), now: () => clock, hasKey: () => false });
    later(5);
    expect(await keyless.tick()).toBe(false);
    expect(sent).toHaveLength(0);
    expect(keyless.summary()).toMatchObject({ keySet: false, waiting: 1 });
    expect(keyless.statusOf(id)).toMatchObject({ state: "waiting", needsKey: true });
  });

  it("reports calls left and waiting for the top bar", async () => {
    await capture({ text: "one" }); await capture({ text: "two" });
    sqlite.prepare("INSERT INTO ai_usage (day, role, calls) VALUES ('2026-11-07', 'archivist', 88)").run();
    expect((await call("GET", "/api/ai")).json).toMatchObject({ keySet: true, left: 1000 - 88, waiting: 2 });
  });
});
