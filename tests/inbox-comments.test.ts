import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const inbox = mkdtempSync(join(tmpdir(), "garden-inbox-"));
process.env.GARDEN_INBOX_DIR = inbox;
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");
const { fullObject } = await import("../src/server/researcher.ts");

// Issue #63: the owner's phone-capture comment is found by Search and read, as the owner's words, with its Source.
let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => {
  for (const f of readdirSync(inbox)) rmSync(join(inbox, f), { recursive: true, force: true });
  sqlite = openDb(":memory:").sqlite;
  app = createApp(sqlite, { readLink: () => {} });
});
const SENT = "2026-11-05T09:30:00.000Z";
let n = 0;
async function capture(text: string, links: string[]) {
  const dir = join(inbox, `m${++n}`);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "capture.json");
  writeFileSync(p, JSON.stringify({ messageId: 100 + n, sentAt: SENT, text, links }));
  const old = new Date(Date.now() - 10 * 60_000); utimesSync(p, old, old);
  await app.request("/api/inbox/scan", { method: "POST" });
  const day = (await (await app.request("/api/inbox/days/2026-11-05")).json()) as any;
  return day.entries[day.entries.length - 1];
}
const search = async (q: string) => (await (await app.request(`/api/find?q=${encodeURIComponent(q)}`)).json()) as any;
const patch = (id: number, comment: string) => app.request(`/api/inbox/captures/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ comment }) });

describe("Search finds comments", () => {
  it("finds the Source by words from its comment and shows the match as a comment from the inbox", async () => {
    const e = await capture("orchids need patience", ["https://example.com/1"]);
    const r = await search("orchids");
    expect(r.hits.map((h: any) => h.id)).toEqual([e.objects[0].id]);
    expect(r.hits[0].match).toMatchObject({ where: "comment", label: "Comment from the inbox", origin: { origin: "owner" } });
  });
  it("follows an edit, and stops finding it once it has become a Thought", async () => {
    const e = await capture("orchids need patience", ["https://example.com/1"]);
    await patch(e.id, "tulips instead");
    expect((await search("orchids")).hits).toHaveLength(0);
    expect((await search("tulips")).hits).toHaveLength(1);
    await app.request(`/api/inbox/captures/${e.id}/thought`, { method: "POST" });
    const hits = (await search("tulips")).hits;
    expect(hits.every((h: any) => h.match?.where !== "comment")).toBe(true);
    expect(hits.map((h: any) => h.id)).not.toContain(e.objects[0].id);
  });
  it("finds a Private capture's comment for the owner", async () => {
    const e = await capture("secret orchids #private", ["https://example.com/p"]);
    expect((await search("orchids")).hits.map((h: any) => h.id)).toEqual([e.objects[0].id]);
  });
});

describe("the AI reads a comment with its Source", () => {
  it("shows the Archivist the comment as the owner's words, and updates when it is edited", async () => {
    const e = await capture("orchids need patience", ["https://example.com/1"]);
    const text = JSON.stringify(archivistPrompt(sqlite, e.objects[0].id)!.messages);
    expect(text).toContain("Comment sent with it (the owner's words): orchids need patience");
    await patch(e.id, "tulips instead");
    expect(JSON.stringify(archivistPrompt(sqlite, e.objects[0].id)!.messages)).toContain("tulips instead");
  });
  it("shows the Researcher the comment only inside its Source, labelled the owner's", async () => {
    const e = await capture("orchids need patience", ["https://example.com/1"]);
    const card = fullObject(sqlite, "o1", e.objects[0].id, 5000);
    expect(card).toContain("Comment sent with it (the owner's words): orchids need patience");
  });
  it("never sends a Private capture's comment", async () => {
    const e = await capture("secret orchids #private", ["https://example.com/p"]);
    expect(archivistPrompt(sqlite, e.objects[0].id)).toBeNull();
    // even if only the capture is marked Private, its comment is not read
    sqlite.prepare("UPDATE objects SET private = 0 WHERE id = ?").run(e.objects[0].id);
    expect(JSON.stringify(archivistPrompt(sqlite, e.objects[0].id)!.messages)).not.toContain("orchids");
  });
  it("stops showing the comment once it has become a Thought", async () => {
    const e = await capture("orchids need patience", ["https://example.com/1"]);
    await app.request(`/api/inbox/captures/${e.id}/thought`, { method: "POST" });
    expect(JSON.stringify(archivistPrompt(sqlite, e.objects[0].id)!.messages)).not.toContain("Comment sent with it");
  });
});
