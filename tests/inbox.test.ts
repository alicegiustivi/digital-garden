import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const inbox = mkdtempSync(join(tmpdir(), "garden-inbox-"));
process.env.GARDEN_INBOX_DIR = inbox;
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { readWords, localDay } = await import("../src/server/inbox.ts");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
let read: { id: string; url: string }[];
let shown: string[];
beforeEach(() => {
  for (const f of readdirSync(inbox)) require_rm(join(inbox, f));
  sqlite = openDb(":memory:").sqlite;
  read = []; shown = [];
  app = createApp(sqlite, { readLink: (id, url) => read.push({ id, url }), reveal: (p) => shown.push(p) });
});
import { rmSync } from "node:fs";
function require_rm(p: string) { rmSync(p, { recursive: true, force: true }); }

const SENT = "2026-11-05T09:30:00.000Z";
/** Drop a capture folder the way the bot will: photos first, the description last. */
function drop(name: string, desc: any, photos: Record<string, Buffer | string> = {}) {
  const dir = join(inbox, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, b] of Object.entries(photos)) writeFileSync(join(dir, f), b);
  if (desc) {
    const p = join(dir, "capture.json");
    writeFileSync(p, typeof desc === "string" ? desc : JSON.stringify(desc));
    const old = new Date(Date.now() - 10 * 60_000); // long enough ago that it isn't "still syncing"
    utimesSync(p, old, old);
  }
  return dir;
}
const scan = async () => (await (await app.request("/api/inbox/scan", { method: "POST" })).json()) as any;
const day = async (d = localDay(new Date(SENT))) => (await (await app.request(`/api/inbox/days/${d}`)).json()) as any;
const obj = async (id: string) => (await (await app.request(`/api/objects/${id}`)).json()) as any;
const post = (url: string, body: unknown = {}) => app.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const field = (o: any, k: string) => o.fields.find((f: any) => f.key === k);

describe("taking a capture folder", () => {
  it("waits for the description file, then makes the Objects and deletes the folder", async () => {
    const dir = drop("m1", null, { "a.png": PNG }); // photo arrived, description not yet
    expect((await scan()).taken).toBe(0);
    expect(existsSync(dir)).toBe(true);
    expect((await day()).entries).toHaveLength(0);
    drop("m1", { messageId: 1, sentAt: SENT, text: "just a thought" }, { "a.png": PNG });
    expect((await scan()).taken).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });
  it("keeps one capture when the same message arrives twice", async () => {
    drop("m1", { messageId: 7, sentAt: SENT, text: "once" });
    await scan();
    const second = drop("m1-again", { messageId: 7, sentAt: SENT, text: "once" });
    await scan();
    expect(existsSync(second)).toBe(false);
    expect((await day()).entries).toHaveLength(1);
    expect((sqlite.prepare("SELECT count(*) AS n FROM objects").get() as any).n).toBe(1);
  });
  it("turns plain text into an Unreviewed Thought in the owner's words, dated the day it was sent", async () => {
    drop("m1", { messageId: 1, sentAt: SENT, text: "Walking helps me think." });
    await scan();
    const e = (await day()).entries[0];
    expect(e.objects).toHaveLength(1);
    const t = await obj(e.objects[0].id);
    expect(t.type).toBe("thought");
    expect(t.unreviewed).toBe(true);
    expect(t.blocks[0]).toMatchObject({ text: "Walking helps me think.", origin: "owner" });
    expect(t.createdAt.startsWith("2026-11-05T09:30:00")).toBe(true);
    expect(e.comment).toBeNull();
  });
  it("turns a link into a Source and asks for it to be read; the words stay as the comment", async () => {
    drop("m1", { messageId: 2, sentAt: SENT, text: "Great read #reading", links: ["https://example.com/a?utm_source=x#top"] });
    await scan();
    const e = (await day()).entries[0];
    const s = await obj(e.objects[0].id);
    expect(s.type).toBe("source");
    expect(field(s, "link")).toMatchObject({ value: "https://example.com/a", origin: "source" });
    expect(field(s, "format").value).toBe("web page");
    expect(s.blocks).toHaveLength(0);
    expect(s.tags.map((t: any) => [t.name, t.origin])).toEqual([["reading", "owner"]]);
    expect(e.comment).toBe("Great read");
    expect(read).toHaveLength(1);
  });
  it("takes links written in the words when the description lists none", async () => {
    drop("m1", { messageId: 3, sentAt: SENT, text: "see https://example.com/x for later" });
    await scan();
    const e = (await day()).entries[0];
    expect(e.objects.map((o: any) => o.type)).toEqual(["source"]);
    expect(e.comment).toBe("see for later");
  });
  it("turns an album into one image Source each, with one comment under the group", async () => {
    drop("m1", { messageId: 4, sentAt: SENT, text: "Trip", files: [{ name: "a.png" }, { name: "b.png" }] }, { "a.png": PNG, "b.png": PNG });
    await scan();
    const e = (await day()).entries[0];
    expect(e.objects).toHaveLength(2);
    for (const o of e.objects) { expect(o.hasImage).toBe(true); expect(field(o, "format").value).toBe("image"); }
    expect(e.comment).toBe("Trip");
  });
  it("turns several links into one Source each", async () => {
    drop("m1", { messageId: 5, sentAt: SENT, text: "two", links: ["https://example.com/1", "https://example.com/2"] });
    await scan();
    expect((await day()).entries[0].objects).toHaveLength(2);
    expect(read).toHaveLength(2);
  });
  it("turns a forward into a Source of format 'post' with Source Origin", async () => {
    drop("m1", { messageId: 6, sentAt: SENT, text: "so true", forward: { text: "The original post.", author: "Some Channel", url: "https://t.me/chan/12" } });
    await scan();
    const e = (await day()).entries[0];
    const s = await obj(e.objects[0].id);
    expect(field(s, "format")).toMatchObject({ value: "post", origin: "source" });
    expect(field(s, "captured")).toMatchObject({ value: "The original post.", origin: "source" });
    expect(field(s, "authors")).toMatchObject({ value: "Some Channel", origin: "source" });
    expect(field(s, "link").value).toBe("https://t.me/chan/12");
    expect(e.comment).toBe("so true");
  });
  it("lists a day's captures in time order and puts a capture on the day it was sent, even if picked up later", async () => {
    drop("b", { messageId: 11, sentAt: "2026-11-05T18:00:00Z", text: "later" });
    drop("a", { messageId: 10, sentAt: "2026-11-05T08:00:00Z", text: "earlier" });
    drop("c", { messageId: 12, sentAt: "2026-11-01T12:00:00Z", text: "days ago" });
    await scan();
    const d = await day("2026-11-05" === localDay(new Date("2026-11-05T08:00:00Z")) ? "2026-11-05" : localDay(new Date("2026-11-05T08:00:00Z")));
    expect(d.entries.map((e: any) => e.objects[0].firstLine)).toEqual(["earlier", "later"]);
    expect((await day(localDay(new Date("2026-11-01T12:00:00Z")))).entries).toHaveLength(1);
  });
});

describe("#private and hashtags", () => {
  it("removes #private anywhere (any case) and makes the whole capture Private", async () => {
    expect(readWords("my #Private idea")).toMatchObject({ text: "my idea", private: true, tags: [] });
    drop("m1", { messageId: 20, sentAt: SENT, text: "#PRIVATE look", links: ["https://example.com/p"], files: [{ name: "a.png" }] }, { "a.png": PNG });
    await scan();
    const e = (await day()).entries[0];
    expect(e.private).toBe(true);
    expect(e.objects.every((o: any) => o.private)).toBe(true);
    expect(e.comment).toBe("look");
  });
  it("keeps hashtags inside a sentence in the text, drops trailing ones, and makes every one an Owner Tag", () => {
    const w = readWords("Reading about #stoicism today\n\n#books #Slow");
    expect(w.text).toBe("Reading about #stoicism today");
    expect(w.tags).toEqual(["stoicism", "books", "slow"]);
  });
  it("makes Thoughts' tags Owner Origin too, and never queues Private ones for the AI", async () => {
    drop("m1", { messageId: 21, sentAt: SENT, text: "calm #habits #private" });
    await scan();
    const t = await obj((await day()).entries[0].objects[0].id);
    expect(t.private).toBe(true);
    expect(t.blocks[0].text).toBe("calm");
    expect(t.tags[0]).toMatchObject({ name: "habits", origin: "owner" });
    expect((sqlite.prepare("SELECT count(*) AS n FROM ai_jobs").get() as any).n).toBe(0);
  });
});

describe("the owner's comment", () => {
  it("shows on its Sources, edits as one text, and becomes a Thought connected to each Source", async () => {
    drop("m1", { messageId: 30, sentAt: SENT, text: "why this matters", links: ["https://example.com/1", "https://example.com/2"] });
    await scan();
    const e = (await day()).entries[0];
    const [a, b] = e.objects;
    const onA = await (await app.request(`/api/objects/${a.id}/inbox`)).json() as any;
    expect(onA).toMatchObject({ comment: "why this matters", day: localDay(new Date(SENT)) });
    await app.request(`/api/inbox/captures/${e.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment: "why it matters now" }) });
    expect(((await (await app.request(`/api/objects/${b.id}/inbox`)).json()) as any).comment).toBe("why it matters now");
    const made = (await (await post(`/api/inbox/captures/${e.id}/thought`)).json()) as any;
    const th = await obj(made.id);
    expect(th).toMatchObject({ type: "thought", unreviewed: false });
    expect(th.blocks[0]).toMatchObject({ text: "why it matters now", origin: "owner" });
    expect(th.createdAt.startsWith("2026-11-05T09:30")).toBe(true);
    const cons = sqlite.prepare("SELECT to_id, kind, origin FROM connections WHERE from_id = ?").all(made.id) as any[];
    expect(cons.map((c) => [c.to_id, c.kind, c.origin]).sort()).toEqual([[a.id, "related", "owner"], [b.id, "related", "owner"]].sort());
    const after = await day();
    expect(after.entries[0].comment).toBeNull();
    expect(after.entries[0].thought.id).toBe(made.id);
    expect(await (await app.request(`/api/objects/${a.id}/inbox`)).json()).toBeNull();
  });
});

describe("failures and refusals", () => {
  it("refuses voice notes, PDFs and files over 20 MB: nothing saved, the folder stays, no Retry", async () => {
    for (const [i, f] of [{ name: "v.ogg", kind: "voice" }, { name: "x.pdf" }].entries()) drop(`r${i}`, { messageId: 40 + i, sentAt: SENT, files: [f] }, { [f.name]: "x" });
    drop("big", { messageId: 50, sentAt: SENT, files: [{ name: "big.png" }] }, { "big.png": Buffer.alloc(20 * 1024 * 1024 + 1) });
    await scan();
    const d = await day();
    expect(d.entries.map((e: any) => [e.status, e.refused])).toEqual([["failed", true], ["failed", true], ["failed", true]]);
    expect(d.entries[0].reason).toMatch(/voice notes|PDFs|20 MB/);
    expect((sqlite.prepare("SELECT count(*) AS n FROM objects").get() as any).n).toBe(0);
    expect(readdirSync(inbox).sort()).toEqual(["big", "r0", "r1"]);
  });
  it("leaves an unreadable photo in the folder as failed, saves nothing, and Retry takes it once it is fixed", async () => {
    const dir = drop("m1", { messageId: 60, sentAt: SENT, text: "pic", files: [{ name: "a.png" }] }, { "a.png": "not a picture" });
    await scan();
    let d = await day();
    expect(d.entries[0]).toMatchObject({ status: "failed", refused: false });
    expect(existsSync(dir)).toBe(true);
    expect((sqlite.prepare("SELECT count(*) AS n FROM objects").get() as any).n).toBe(0);
    await scan(); // not retried by itself
    expect((await day()).entries).toHaveLength(1);
    writeFileSync(join(dir, "a.png"), PNG);
    expect(((await (await post(`/api/inbox/captures/${d.entries[0].id}/retry`)).json()) as any).outcome).toBe("done");
    d = await day();
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ status: "done", comment: "pic" });
    expect(d.entries[0].objects).toHaveLength(1);
    expect(existsSync(dir)).toBe(false);
  });
  it("takes a capture by itself once a file that was still downloading from Drive has arrived", async () => {
    drop("late", "{", { "a.png": PNG }); // the description is there but its contents haven't downloaded yet
    expect((await scan()).failed).toBe(1);
    drop("late", { messageId: "late1", sentAt: SENT, files: [{ name: "a.png" }] }, { "a.png": PNG });
    expect((await scan()).taken).toBe(1); // no Retry needed
    expect(existsSync(join(inbox, "late"))).toBe(false);
  });
  it("shows a description it can't read as failed, and offers Show file", async () => {
    drop("broken", "{ not json");
    await scan();
    const e = (await day(localDay(new Date()))).entries[0];
    expect(e.status).toBe("failed");
    await post(`/api/inbox/captures/${e.id}/reveal`);
    expect(shown).toEqual([join(inbox, "broken")]);
  });
});

describe("watching the Drive folder", () => {
  it("warns when the folder is missing, or its heartbeat is more than a day old", async () => {
    const old = new Date(Date.now() - 30 * 3600_000);
    writeFileSync(join(inbox, "heartbeat.txt"), "x");
    utimesSync(join(inbox, "heartbeat.txt"), old, old);
    expect((await scan()).warning.kind).toBe("stale");
    const now = new Date();
    utimesSync(join(inbox, "heartbeat.txt"), now, now);
    expect((await scan()).warning).toBeNull();
    process.env.GARDEN_INBOX_DIR = join(inbox, "gone");
    expect((await scan()).warning.kind).toBe("missing");
    process.env.GARDEN_INBOX_DIR = inbox;
  });
  it("lists the days that have captures, and which Unreviewed Objects came through the inbox", async () => {
    drop("m1", { messageId: 70, sentAt: SENT, text: "hi" });
    const s = await scan();
    expect(s.days).toEqual([{ day: localDay(new Date(SENT)), count: 1, failed: 0 }]);
    const id = (await day()).entries[0].objects[0].id;
    expect(await (await app.request(`/api/inbox/of?ids=${id}`)).json()).toEqual({ [id]: localDay(new Date(SENT)) });
  });
});
