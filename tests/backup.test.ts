import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const drive = mkdtempSync(join(tmpdir(), "garden-drive-"));
process.env.GARDEN_BACKUP_DIR = drive;
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const bk = await import("../src/server/backup.ts");
const { imagesDir } = await import("../src/server/paths.ts");

const PW = "correct horse battery"; // a test value only
const day = (iso: string) => ({ now: () => new Date(iso) });
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => {
  rmSync(drive, { recursive: true, force: true }); mkdirSync(drive, { recursive: true });
  rmSync(bk.backupStatePath(), { force: true });
  rmSync(imagesDir(), { recursive: true, force: true }); mkdirSync(imagesDir(), { recursive: true });
  sqlite = openDb(":memory:").sqlite;
  sqlite.prepare("INSERT INTO objects (id, type, created_at, updated_at) VALUES ('11111111-1111-1111-1111-111111111111','thought',datetime('now'),datetime('now'))").run();
});
const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

describe("backup and custom types (issue #107)", () => {
  it("a Backup brings back a type the owner made, its colour, icon, properties and Objects, intact", async () => {
    sqlite.prepare("INSERT INTO object_types (key, label, plural, position, color, icon, core) VALUES ('x-book','Book','Books',5,'rose','book',0)").run();
    sqlite.prepare("INSERT INTO field_definitions (key, label, input, options) VALUES ('c-1','Author','text',NULL)").run();
    sqlite.prepare("INSERT INTO type_fields (type, field, position, lead) VALUES ('x-book','c-1',0,1)").run();
    sqlite.prepare("INSERT INTO objects (id, type, created_at, updated_at) VALUES ('22222222-2222-2222-2222-222222222222','x-book',datetime('now'),datetime('now'))").run();
    sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES ('22222222-2222-2222-2222-222222222222','c-1','Frank Herbert','owner')").run();
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-11-10T03:12:00") });
    const into = join(mkdtempSync(join(tmpdir(), "garden-spare-")), "restored");
    await bk.restoreBackup(drive, PW, into);
    const { default: Database } = await import("better-sqlite3");
    const back = new Database(join(into, "garden.db"), { readonly: true });
    expect(back.prepare("SELECT label, plural, color, icon, core FROM object_types WHERE key = 'x-book'").get()).toEqual({ label: "Book", plural: "Books", color: "rose", icon: "book", core: 0 });
    expect(back.prepare("SELECT lead FROM type_fields WHERE type = 'x-book'").get()).toEqual({ lead: 1 });
    expect(back.prepare("SELECT value FROM field_values WHERE field = 'c-1'").get()).toEqual({ value: "Frank Herbert" });
    expect(back.prepare("SELECT type FROM objects WHERE id = '22222222-2222-2222-2222-222222222222'").get()).toEqual({ type: "x-book" });
    back.close();
  });
});

describe("backup", () => {
  it("encrypts everything, and restores into a spare folder", async () => {
    writeFileSync(join(imagesDir(), "a.jpg"), "PICTURE-SECRET-BYTES");
    const r = await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-11-09T03:12:00") });
    expect(r.ok).toBe(true);
    for (const f of walk(drive).filter((f) => f.endsWith(".enc"))) {
      const b = readFileSync(f);
      expect(b.includes("PICTURE-SECRET-BYTES")).toBe(false);
      expect(b.includes("SQLite format")).toBe(false);
    }
    const into = join(mkdtempSync(join(tmpdir(), "garden-spare-")), "restored");
    const res = await bk.restoreBackup(drive, PW, into);
    expect(res).toMatchObject({ day: "2026-11-09", objects: 1, images: 1, imagesMissing: 0, integrity: "ok" });
    expect(readFileSync(join(into, "images", "a.jpg"), "utf8")).toBe("PICTURE-SECRET-BYTES");
  });
  it("refuses a wrong password, and never restores over a folder that has things in it", async () => {
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-11-09T03:12:00") });
    const spare = mkdtempSync(join(tmpdir(), "garden-spare-"));
    await expect(bk.restoreBackup(drive, "nope", join(spare, "x"))).rejects.toThrow(/password/);
    writeFileSync(join(spare, "keep.txt"), "x");
    await expect(bk.restoreBackup(drive, PW, spare)).rejects.toThrow(/empty/);
    const bad = await bk.runBackup(sqlite, { password: async () => "other", ...day("2026-11-10T03:12:00") });
    expect(bad.ok).toBe(false);
  });
  it("copies each image once, the database each day, and keeps 4 weeks", async () => {
    writeFileSync(join(imagesDir(), "a.jpg"), "one");
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-10-01T03:00:00") });
    const copy = join(drive, "images", "a.jpg.enc");
    const first = readFileSync(copy);
    writeFileSync(join(imagesDir(), "b.jpg"), "two");
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-10-02T03:00:00") });
    expect(readFileSync(copy).equals(first)).toBe(true); // not uploaded again
    expect(readdirSync(join(drive, "db")).length).toBe(2);
    rmSync(join(imagesDir(), "a.jpg"));
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-11-09T03:00:00") }); // 38 days later: Oct 1 and 2 expire
    expect(readdirSync(join(drive, "db"))).toEqual(["garden-2026-11-09.db.enc"]);
    expect(existsSync(copy)).toBe(false); // nothing kept lists it any more
    expect(existsSync(join(drive, "images", "b.jpg.enc"))).toBe(true); // b.jpg is still in the Garden
  });
  it("is due after 03:00 once a day, and waits an hour after a failure", async () => {
    const calls: string[] = [];
    const d = (iso: string) => ({ password: async () => { calls.push(iso); return PW; }, ...day(iso) });
    await bk.backupIfDue(sqlite, d("2026-11-09T02:00:00"));
    expect(calls.length).toBe(0);
    await bk.backupIfDue(sqlite, d("2026-11-09T03:05:00"));
    await bk.backupIfDue(sqlite, d("2026-11-09T09:00:00"));
    expect(calls.length).toBe(1); // already done today
    await bk.backupIfDue(sqlite, d("2026-11-10T03:05:00"));
    expect(calls.length).toBe(2);
  });
  it("says 'Backup hasn't run since Tuesday' after two days without one", async () => {
    await bk.runBackup(sqlite, { password: async () => PW, ...day("2026-11-03T03:12:00") }); // a Tuesday
    expect(bk.backupStatus(new Date("2026-11-04T10:00:00")).warning).toBeNull();
    expect(bk.backupStatus(new Date("2026-11-03T20:00:00")).line).toMatch(/Backed up today 03:12/);
    expect(bk.backupStatus(new Date("2026-11-05T10:00:00")).warning?.text).toBe("Backup hasn't run since Tuesday");
  });
  it("works through the app: status and Try again", async () => {
    const app = createApp(sqlite, { backup: { password: async () => PW } });
    expect(((await (await app.request("/api/backup")).json()) as any).folder).toBe(drive);
    const r = (await (await app.request("/api/backup/run", { method: "POST" })).json()) as any;
    expect(r.ok).toBe(true);
    expect(r.line).toMatch(/^Backed up today/);
    const none = createApp(sqlite, { backup: { password: async () => null } });
    const f = (await (await none.request("/api/backup/run", { method: "POST" })).json()) as any;
    expect(f.ok).toBe(false);
    expect(JSON.stringify(f)).not.toContain(PW);
  });
});
