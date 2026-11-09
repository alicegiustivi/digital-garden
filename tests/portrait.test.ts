// Issue #69: a Person's Portrait.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");
const { purgeObjects } = await import("../src/server/bin.ts");
const { bringBack } = await import("../src/server/bring-back.ts");
const ex = await import("../src/server/export.ts");
const { imagesDir } = await import("../src/server/paths.ts");

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
let big: Buffer, heic: Buffer;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "garden-fixture-"));
  const tiny = join(dir, "tiny.png");
  writeFileSync(tiny, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const bigFile = join(dir, "big.png");
  execFileSync("/usr/bin/sips", ["-z", "3000", "4000", tiny, "--out", bigFile]);
  big = readFileSync(bigFile);
  const h = join(dir, "photo.heic");
  execFileSync("/usr/bin/sips", ["-s", "format", "heic", bigFile, "--out", h]);
  heic = readFileSync(h);
});
beforeEach(() => {
  rmSync(imagesDir(), { recursive: true, force: true });
  sqlite = openDb(":memory:").sqlite;
  app = createApp(sqlite);
});

const make = async (type: string, priv = false) => {
  const o = (await (await app.request("/api/objects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) })).json()) as any;
  if (priv) sqlite.prepare("UPDATE objects SET private = 1 WHERE id = ?").run(o.id);
  return o.id as string;
};
const put = async (id: string, name: string, data: Buffer) => {
  const form = new FormData();
  form.set("image", new File([new Uint8Array(data)], name));
  const res = await app.request(`/api/objects/${id}/portrait`, { method: "PUT", body: form });
  return { status: res.status, json: (await res.json()) as any };
};
const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;
const files = (id: string) => readdirSync(imagesDir()).filter((f) => f.startsWith(`portrait-${id}-`)).sort();
const width = (f: string) => Number(execFileSync("/usr/bin/sips", ["-g", "pixelWidth", join(imagesDir(), f)]).toString().match(/(\d+)\s*$/)![1]);

describe("Portrait", () => {
  it("shrinks a photo to about 2048 px with a thumbnail, never keeping the original, and it has Owner Origin", async () => {
    const id = await make("person");
    const r = await put(id, "Ada.PNG", big);
    expect(r.status).toBe(200);
    const stem = r.json.portrait as string;
    expect(files(id)).toEqual([`${stem}.jpg`, `${stem}.thumb.jpg`]);
    expect(width(`${stem}.jpg`)).toBe(2048);
    expect(width(`${stem}.thumb.jpg`)).toBe(400);
    expect(sqlite.prepare("SELECT origin FROM person_portraits WHERE object_id = ?").get(id)).toEqual({ origin: "owner" });
    const got = await app.request(`/api/portraits/${stem}/thumb`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect(r.json.previous).toBeNull();
  });
  it("reads a HEIC photo", async () => {
    const id = await make("person");
    const r = await put(id, "IMG_1.HEIC", heic);
    expect(r.status).toBe(200);
    expect(width(`${r.json.portrait}.jpg`)).toBe(2048);
  });
  it("refuses a file that is not a picture, and keeps what was there", async () => {
    const id = await make("person");
    const r = await put(id, "notes.txt", Buffer.from("hello"));
    expect(r.status).toBe(400);
    expect(files(id)).toEqual([]);
    expect((await (await app.request(`/api/objects/${id}`)).json() as any).portrait).toBeNull();
  });
  it("is only for a Person", async () => {
    const t = await make("thought");
    expect((await put(t, "a.png", big)).status).toBe(400);
  });
  it("shows on the Person, on Object Card info and in lists", async () => {
    const p = await make("person");
    const s = await make("source");
    const stem = (await put(p, "a.png", big)).json.portrait;
    sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?,?,?,'owner')").run(s, p, "related");
    expect(((await (await app.request("/api/objects?type=person")).json()) as any[])[0].portrait).toBe(stem);
    const conns = (await (await app.request(`/api/objects/${s}/connections`)).json()) as any;
    expect(JSON.stringify(conns)).toContain(stem);
    sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?,?,?,'owner')").run(s, 0, `[[o:${p}]]`);
    expect(((await (await app.request(`/api/objects/${s}`)).json()) as any).mentions[p].portrait).toBe(stem);
  });
  it("replaces with Undo, removes with Undo, and keeps only what Undo needs", async () => {
    const id = await make("person");
    const first = (await put(id, "a.png", big)).json;
    const second = (await put(id, "b.png", big)).json;
    expect(second.previous.stem).toBe(first.portrait);
    expect(files(id)).toHaveLength(4); // current + the one Undo may bring back
    const undone = await post(`/api/objects/${id}/portrait/restore`, { back: second.previous });
    expect(undone.portrait).toBe(first.portrait);
    const removed = await (await app.request(`/api/objects/${id}/portrait`, { method: "DELETE" })).json() as any;
    expect(removed.portrait).toBeNull();
    expect(removed.previous.stem).toBe(first.portrait);
    const back = await post(`/api/objects/${id}/portrait/restore`, { back: removed.previous });
    expect(back.portrait).toBe(first.portrait);
    expect((await app.request(`/api/portraits/${first.portrait}/full`)).status).toBe(200);
  });
  it("Undo cannot name another Person's or an invented file", async () => {
    const a = await make("person"), b = await make("person");
    const other = (await put(b, "a.png", big)).json.portrait;
    const bad = await app.request(`/api/objects/${a}/portrait/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ back: { stem: other } }) });
    expect(bad.status).toBe(400);
    const worse = await app.request(`/api/objects/${a}/portrait/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ back: { stem: "../../etc/passwd" } }) });
    expect(worse.status).toBe(400);
    expect((await app.request("/api/portraits/..%2Fgarden.db/full")).status).toBe(404);
  });
  it("a Private Person keeps their Portrait", async () => {
    const id = await make("person", true);
    const r = await put(id, "a.png", big);
    expect(r.status).toBe(200);
    expect(((await (await app.request(`/api/objects/${id}`)).json()) as any).portrait).toBe(r.json.portrait);
  });
  it("no AI step reads it: not a field, not a source image, not in the Archivist's prompt", async () => {
    const id = await make("person");
    sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES (?, 'title', 'Ada Lovelace', 'owner')").run(id);
    const stem = (await put(id, "a.png", big)).json.portrait as string;
    expect(sqlite.prepare("SELECT count(*) AS n FROM field_values WHERE value LIKE '%portrait%'").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT count(*) AS n FROM source_images").get()).toEqual({ n: 0 });
    const prompt = JSON.stringify(archivistPrompt(sqlite, id));
    expect(prompt).not.toContain(stem);
    expect(prompt).not.toContain("image_url");
    for (const f of ["ai-queue.ts", "ai-prompt.ts", "researcher.ts", "archivist.ts", "suggestions.ts"]) expect(readFileSync(join("src/server", f), "utf8")).not.toMatch(/portrait/i);
  });
  it("leaves the Bin with the Object: files go on purge, not before", async () => {
    const id = await make("person");
    await put(id, "a.png", big);
    await app.request(`/api/objects/${id}`, { method: "DELETE" });
    expect(files(id)).toHaveLength(2);
    purgeObjects(sqlite, [id]);
    await new Promise((r) => setTimeout(r, 200));
    expect(files(id)).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM person_portraits").get()).toEqual({ n: 0 });
  });
  it("comes back with a Person brought back from a Backup", async () => {
    const id = await make("person");
    const stem = (await put(id, "a.png", big)).json.portrait as string;
    const spareDir = mkdtempSync(join(tmpdir(), "spare-")), liveDir = mkdtempSync(join(tmpdir(), "live-"));
    for (const f of readdirSync(imagesDir())) writeFileSync(join(spareDir, f), readFileSync(join(imagesDir(), f)));
    const spare = openDb(":memory:").sqlite;
    for (const t of ["objects", "person_portraits"]) for (const row of sqlite.prepare(`SELECT * FROM ${t}`).all() as any[]) {
      const cols = Object.keys(row);
      spare.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...Object.values(row));
    }
    sqlite.prepare("UPDATE objects SET title = 'Ada' WHERE id = ?").run(id); spare.prepare("UPDATE objects SET title = 'Ada' WHERE id = ?").run(id);
    sqlite.prepare("DELETE FROM person_portraits").run(); sqlite.prepare("DELETE FROM objects").run();
    const r = bringBack(spare, sqlite, "d", "Ada", { spareImages: spareDir, liveImages: liveDir }) as any;
    expect(r.status).toBe("brought-back");
    expect(existsSync(join(liveDir, `${stem}.jpg`))).toBe(true);
    expect(sqlite.prepare("SELECT stem FROM person_portraits WHERE object_id = ?").get(id)).toEqual({ stem });
  });
  it("goes in the Export's images/ and is linked from the Person's file", async () => {
    const id = await make("person");
    sqlite.prepare("UPDATE objects SET title = 'Ada Lovelace' WHERE id = ?").run(id);
    const stem = (await put(id, "a.png", big)).json.portrait as string;
    const out = mkdtempSync(join(tmpdir(), "garden-export-"));
    rmSync(ex.exportStatePath(), { force: true });
    const r = await ex.startExport(sqlite, { folder: out }, { now: () => new Date("2026-11-09T10:00:00") });
    expect(r.ok).toBe(true);
    expect(readdirSync(join(r.path!, "images"))).toEqual([`${stem}.jpg`]);
    const md = readFileSync(join(r.path!, readdirSync(r.path!).find((n) => existsSync(join(r.path!, n, "Ada Lovelace.md")))!, "Ada Lovelace.md"), "utf8");
    expect(md).toContain(`](../images/${stem}.jpg)`);
    expect(JSON.parse(readFileSync(join(r.path!, "garden.json"), "utf8")).objects[0].portrait).toMatchObject({ file: `${stem}.jpg`, origin: "owner" });
  });
});
