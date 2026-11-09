import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const ex = await import("../src/server/export.ts");
const { imagesDir } = await import("../src/server/paths.ts");

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const D = "dddddddd-dddd-dddd-dddd-dddddddddddd", E = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", F = "ffffffff-ffff-ffff-ffff-ffffffffffff", G = "99999999-9999-9999-9999-999999999999";
const NOW = new Date("2026-11-09T10:00:00");
let sqlite: ReturnType<typeof openDb>["sqlite"];
let out: string;
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "garden-export-"));
  rmSync(ex.exportStatePath(), { force: true });
  rmSync(imagesDir(), { recursive: true, force: true }); mkdirSync(imagesDir(), { recursive: true });
  writeFileSync(join(imagesDir(), "pic.jpg"), "SHRUNK"); writeFileSync(join(imagesDir(), "pic-thumb.jpg"), "THUMB");
  sqlite = openDb(":memory:").sqlite;
  const o = sqlite.prepare("INSERT INTO objects (id, type, title, private, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?)");
  o.run(A, "source", "Attention/Is: all?", 0, "2026-11-01 09:00:00", "2026-11-02 09:00:00", null);
  o.run(B, "source", "Attention/Is: all?", 0, "2026-11-01 09:00:00", null, null);   // same title again
  o.run(C, "thought", null, 1, "2026-11-03 09:00:00", null, null);                  // Private, untitled
  o.run(D, "concept", "Focus", 0, "2026-11-04 09:00:00", null, null);
  o.run(E, "person", "Gone", 0, "2026-11-04 09:00:00", null, "2026-11-05 09:00:00"); // in the Bin
  o.run(F, "source", "A picture", 0, "2026-11-04 09:00:00", null, null);
  const blk = sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin, ai_role, ai_model, ai_date) VALUES (?,?,?,?,?,?,?)");
  blk.run(C, 0, `My secret thought about [[o:${A}]]`, "owner", null, null, null);
  blk.run(A, 0, `I think of [[o:${C}]] and [[o:${D}]] and [[o:${E}]]`, "owner", null, null, null);
  blk.run(A, 1, "A quoted line from the book", "source", null, null, null);
  blk.run(A, 2, "An AI paragraph", "ai", "archivist", "model-x", "2026-11-02");
  sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date, approved) VALUES (?,?,?,?,?,?,?,?)").run(A, "authors", "Ada", "ai", "archivist", "model-x", "2026-11-02", 1);
  sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES (?,?,?,?)").run(A, "link", "https://example.org", "source");
  sqlite.prepare("INSERT INTO tags (name) VALUES ('focus'), ('onlyprivate')").run();
  sqlite.prepare("INSERT INTO object_tags (object_id, tag_id, origin) VALUES (?,1,'owner')").run(A);
  sqlite.prepare("INSERT INTO object_tags (object_id, tag_id, origin) VALUES (?,2,'owner')").run(C);
  const con = sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, note, origin, ai_role, ai_model, ai_date) VALUES (?,?,?,?,?,?,?,?)");
  con.run(A, D, "supports", "because", "ai", "archivist", "model-x", "2026-11-02");
  con.run(A, C, "related", null, "owner", null, null, null);
  con.run(A, E, "related", null, "owner", null, null, null);
  sqlite.prepare("INSERT INTO source_images (object_id, file, thumb, width, height) VALUES (?, 'pic.jpg', 'pic-thumb.jpg', 10, 10)").run(F);
  sqlite.prepare("INSERT INTO concept_versions (object_id, day, paragraphs) VALUES (?, '2026-11-03', '[\"Earlier view\"]')").run(D);
  sqlite.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at) VALUES (?, 'summary', 'A summary', 'archivist', 'model-x', '2026-11-02', '2026-11-02')").run(A);
  sqlite.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'type', '{\"type\":\"concept\"}', 'archivist', 'model-x', '2026-11-02', '2026-11-02')").run(A);
  sqlite.prepare("INSERT INTO ai_rejected (object_id, kind, value) VALUES (?, 'tag', 'badtag')").run(A);
  sqlite.prepare("INSERT INTO ai_runs (object_id, model, created_at, changes) VALUES (?, 'model-x', '2026-11-02T01:00:00Z', '[{\"set\":\"title\",\"was\":null}]')").run(A);
  sqlite.prepare("INSERT INTO open_questions (object_id, settled_at, settled_by) VALUES (?, '2026-11-06', ?)").run(C, A);
  sqlite.prepare("INSERT INTO inbox_captures (key, folder, sent_at, day, status, reason, comment) VALUES ('k1','f1','2026-11-04T08:00:00Z','2026-11-04','done',NULL,'my comment')").run();
  sqlite.prepare("INSERT INTO inbox_captures (key, folder, sent_at, day, status, reason) VALUES ('k2','f2','2026-11-04T09:00:00Z','2026-11-04','failed','voice note')").run();
  sqlite.prepare("INSERT INTO inbox_objects (capture_id, object_id, position) VALUES (1, ?, 0)").run(F);
  sqlite.prepare("INSERT INTO inquiries (id, object_id, created_at) VALUES ('q1', NULL, '2026-11-05T08:00:00Z')").run();
  sqlite.prepare("INSERT INTO inquiry_turns (inquiry_id, question, answer, read_ids, ai_role, ai_model, ai_date, created_at) VALUES ('q1','What is focus?',?, ?, 'researcher','model-y','2026-11-05','2026-11-05T08:00:00Z')").run(`Focus is in [[o:${D}]]`, JSON.stringify([D, C]));
  sqlite.prepare("INSERT INTO inquiries (id, object_id, created_at, deleted_at) VALUES ('q2', NULL, '2026-11-05T08:00:00Z', '2026-11-06')").run();
  sqlite.prepare("INSERT INTO inquiry_turns (inquiry_id, question, created_at) VALUES ('q2','Binned question','2026-11-05')").run();
});

const exportOnce = async (opts: { leaveOutPrivate?: boolean } = {}, deps: any = {}) => {
  const r = await ex.startExport(sqlite, { folder: out, ...opts }, { now: () => NOW, ...deps });
  return r;
};
const read = (r: { path?: string }, p: string) => readFileSync(join(r.path!, p), "utf8");

describe("export", () => {
  it("makes a dated folder with every part", async () => {
    const r = await exportOnce();
    expect(r.ok).toBe(true);
    expect(r.path!.endsWith("Garden export 2026-11-09")).toBe(true);
    const names = readdirSync(r.path!).sort();
    for (const n of ["Sources", "Concepts", "Thoughts", "Inquiries", "Daily Inbox", "images", "Tags.md", "Read me first.md", "garden.json"]) expect(names).toContain(n);
    expect(names).not.toContain("People"); // nobody (the only Person is in the Bin)
    expect(readdirSync(join(r.path!, "images"))).toEqual(["pic.jpg"]); // no thumbnails
    expect(readdirSync(out).filter((n) => n.includes("unfinished"))).toEqual([]);
  });
  it("replaces filename characters and numbers duplicate titles; a Thought with no title is named by its first line", async () => {
    const r = await exportOnce();
    expect(readdirSync(join(r.path!, "Sources")).sort()).toEqual(["A picture.md", "Attention-Is- all- (2).md", "Attention-Is- all-.md"]);
    expect(read(r, "Sources/Attention-Is- all-.md")).toContain("# Attention/Is: all?"); // the true title stays inside
    expect(readdirSync(join(r.path!, "Thoughts"))[0]).toMatch(/^My secret thought about/);
  });
  it("keeps Origin marks and the AI line as the Garden shows them", async () => {
    const r = await exportOnce();
    const md = read(r, "Sources/Attention-Is- all-.md");
    expect(md).toContain("✧ Ada"); expect(md).toContain("AI · Archivist · model-x · 2026-11-02");
    expect(md).toContain("❝ https://example.org");
    expect(md).toContain("> ❝ A quoted line from the book");
    expect(md).toContain("✦ An AI paragraph");
    expect(md).toContain("✦ supports [Focus]"); // an unapproved AI Connection
    expect(md).toContain("#focus");
    expect(md).toContain("## From the AI"); expect(md).toContain("A summary");
    expect(md).toContain("## Suggested (not approved)");
    expect(md).toMatch(/\[Focus\]\(\.\.\/Concepts\/Focus\.md\)/); // Mention -> link
    expect(read(r, "Concepts/Focus.md")).toContain("Earlier view");
  });
  it("garden.json holds what the files leave out, and nothing from the Bin", async () => {
    const r = await exportOnce();
    const g = JSON.parse(read(r, "garden.json"));
    expect(g.version).toBe(ex.EXPORT_VERSION);
    const a = g.objects.find((o: any) => o.id === A);
    expect(a.rejectedSuggestions).toEqual([{ kind: "tag", value: "badtag" }]);
    expect(a.editHistory[0].changes).toEqual([{ set: "title", was: null }]);
    expect(a.fields.find((f: any) => f.field === "authors")).toMatchObject({ origin: "ai", approved: true, aiModel: "model-x" });
    expect(g.objects.find((o: any) => o.id === D).conceptVersions[0].paragraphs).toEqual(["Earlier view"]);
    expect(g.dailyInbox.find((c: any) => c.status === "failed").reason).toBe("voice note");
    expect(g.objects.some((o: any) => o.id === E)).toBe(false);
    expect(g.connections.some((c: any) => c.to === E)).toBe(false);
    expect(g.inquiries.map((q: any) => q.id)).toEqual(["q1"]);
    expect(JSON.stringify(g)).not.toContain("Binned question");
    expect(read(r, "Sources/Attention-Is- all-.md")).toContain("[an Object that is no longer in the Garden]");
    expect(g.objects.find((o: any) => o.id === C)).toMatchObject({ private: true, openQuestion: { settledBy: A } });
    expect(read(r, "Thoughts/" + readdirSync(join(r.path!, "Thoughts"))[0])).toContain("**Private**");
    expect(readFileSync(join(r.path!, "Read me first.md"), "utf8")).toContain("not encrypted");
    expect(read(r, "Tags.md")).toContain("#onlyprivate — 1 Object");
    expect(read(r, "Daily Inbox/2026-11-04.md")).toContain("my comment");
    expect(read(r, "Daily Inbox/2026-11-04.md")).not.toContain("voice note");
  });
  it("leaves out Private Objects, their Connections and Mentions, when asked", async () => {
    const r = await exportOnce({ leaveOutPrivate: true });
    const all = walk(r.path!).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(all).not.toContain("My secret thought");
    expect(all).not.toContain("onlyprivate");
    expect(readdirSync(r.path!)).not.toContain("Thoughts");
    expect(read(r, "Sources/Attention-Is- all-.md")).toContain("[a Private Object]");
    const g = JSON.parse(read(r, "garden.json"));
    expect(g.leftOutPrivateObjects).toBe(true);
    expect(g.objects.some((o: any) => o.private)).toBe(false);
    expect(g.connections.every((c: any) => c.from !== C && c.to !== C)).toBe(true);
    expect(g.inquiries[0].turns[0].readObjectIds).toEqual([D]);
  });
  it("deletes a half-written folder when interrupted, and says it didn't finish", async () => {
    const r = await exportOnce({}, { beforeFile: (n: number) => { if (n === 3) throw new Error("disk full"); } });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Export didn't finish");
    expect(readdirSync(out)).toEqual([]);
    expect(ex.exportStatus()).toMatchObject({ state: "failed", line: "Export didn't finish" });
  });
  it("cleans up after the Garden itself stopped mid-Export", async () => {
    mkdirSync(join(out, ".Garden export 2026-11-09 (unfinished)"));
    writeFileSync(ex.exportStatePath(), JSON.stringify({ running: { tmp: join(out, ".Garden export 2026-11-09 (unfinished)"), startedAt: "x" } }));
    await ex.cleanUpUnfinished();
    expect(readdirSync(out)).toEqual([]);
    expect(ex.exportStatus().state).toBe("failed");
  });
  it("never overwrites an earlier Export", async () => {
    const one = await exportOnce(); const two = await exportOnce();
    expect(one.path).not.toBe(two.path); expect(two.path!.endsWith("(2)")).toBe(true);
  });
  it("works through the API, with a status the screen can show", async () => {
    let shown = ""; 
    const app = createApp(sqlite, { exporter: { choose: async () => out, reveal: (p) => { shown = p; } } });
    expect(await (await app.request("/api/export/choose", { method: "POST" })).json()).toEqual({ path: out });
    expect((await app.request("/api/export", { method: "POST", body: JSON.stringify({ folder: "/nonexistent-zzz" }), headers: { "content-type": "application/json" } })).status).toBe(400);
    const started = await (await app.request("/api/export", { method: "POST", body: JSON.stringify({ folder: out }), headers: { "content-type": "application/json" } })).json();
    expect(started.state).toBe("running");
    await ex.awaitExport();
    const s = await (await app.request("/api/export")).json();
    expect(s).toMatchObject({ state: "done", line: "Done" });
    await app.request("/api/export/reveal", { method: "POST" });
    expect(shown).toBe(s.path);
    expect(existsSync(join(s.path, "garden.json"))).toBe(true);
  });
});
