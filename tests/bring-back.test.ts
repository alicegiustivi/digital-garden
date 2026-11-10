import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const { openDb } = await import("../src/server/db.ts");
const { bringBack, findInSpare } = await import("../src/server/bring-back.ts");

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", C = "cccccccc-cccc-cccc-cccc-cccccccccccc";
function world() {
  const spare = openDb(":memory:").sqlite, live = openDb(":memory:").sqlite;
  const put = (db: any, id: string, title: string, extra = "") => db.prepare(`INSERT INTO objects (id,type,title,created_at,updated_at${extra ? ",unreviewed" : ""}) VALUES (?,?,?,datetime('now'),datetime('now')${extra ? ",1" : ""})`).run(id, "source", title);
  put(spare, A, "Gardening Basics", "x"); put(spare, B, "Soil notes"); put(spare, C, "Gardening Basics 2");
  spare.prepare("INSERT INTO blocks (object_id,position,text,origin) VALUES (?,0,'my own words','owner'),(?,1,'from the web','source')").run(A, A);
  spare.prepare("INSERT INTO field_values (object_id,field,value,origin) VALUES (?,'format','book','owner')").run(A);
  spare.prepare("INSERT INTO field_values (object_id,field,value,origin,ai_role,ai_model,ai_date) VALUES (?,'author','Ann','ai','archivist','m:free','2026-11-01')").run(A);
  spare.prepare("INSERT INTO tags (name,color) VALUES ('plants','rose')").run();
  spare.prepare("INSERT INTO object_tags (object_id,tag_id,origin) VALUES (?,1,'owner')").run(A);
  spare.prepare("INSERT INTO connections (from_id,to_id,kind,origin) VALUES (?,?,'related','owner')").run(A, B);
  spare.prepare("INSERT INTO connections (from_id,to_id,kind,origin) VALUES (?,?,'supports','owner')").run(A, C);
  put(live, B, "Soil notes");
  return { spare, live };
}
const dirs = () => ({ spareImages: mkdtempSync(join(tmpdir(), "si-")), liveImages: mkdtempSync(join(tmpdir(), "li-")) });

describe("bring back one Object", () => {
  it("copies it with Origins intact, tags it restored, and keeps only Connections whose other end exists", () => {
    const { spare, live } = world();
    const r2: any = bringBack(spare, live, "2026-11-02", A, { ...dirs() });
    expect(r2).toMatchObject({ status: "brought-back", connectionsSkipped: 1, tag: "restored-2026-11-02" });
    expect(live.prepare("SELECT origin, text FROM blocks WHERE object_id=? ORDER BY position").all(A)).toEqual([{ origin: "owner", text: "my own words" }, { origin: "source", text: "from the web" }]);
    expect(live.prepare("SELECT origin, ai_role, ai_model, ai_date FROM field_values WHERE object_id=? AND field='author'").get(A)).toEqual({ origin: "ai", ai_role: "archivist", ai_model: "m:free", ai_date: "2026-11-01" });
    const tags = live.prepare("SELECT t.name, ot.origin FROM object_tags ot JOIN tags t ON t.id=ot.tag_id WHERE ot.object_id=? ORDER BY t.name").all(A);
    expect(tags).toEqual([{ name: "plants", origin: "owner" }, { name: "restored-2026-11-02", origin: "owner" }]);
    expect(live.prepare("SELECT count(*) AS n FROM connections WHERE from_id=?").get(A)).toEqual({ n: 1 });
    expect(live.prepare("SELECT unreviewed FROM objects WHERE id=?").get(A)).toEqual({ unreviewed: 1 });
    expect((live.prepare("SELECT count(*) AS n FROM search_index WHERE search_index MATCH 'words'").get() as any).n).toBe(1);
  });
  it("never overwrites: refuses when the Object is already there, and points to the Bin", () => {
    const { spare, live } = world();
    expect(bringBack(spare, live, "d", B, { ...dirs() })).toMatchObject({ status: "already-there", inBin: false });
    live.prepare("UPDATE objects SET deleted_at=datetime('now') WHERE id=?").run(B);
    expect(bringBack(spare, live, "d", B, { ...dirs() })).toMatchObject({ status: "already-there", inBin: true });
  });
  it("asks which one when several match, and says when none do; --look changes nothing", () => {
    const { spare, live } = world();
    expect((bringBack(spare, live, "d", "gardening", { ...dirs() }) as any).matches).toHaveLength(2);
    expect(bringBack(spare, live, "d", "zzz", { ...dirs() })).toEqual({ status: "not-found" });
    expect(bringBack(spare, live, "d", A, { ...dirs(), lookOnly: true }).status).toBe("would");
    expect(live.prepare("SELECT 1 FROM objects WHERE id=?").get(A)).toBeUndefined();
    expect(findInSpare(spare, "SOIL")).toHaveLength(1);
  });
  it("copies an image Source's pictures", () => {
    const { spare, live } = world();
    const d = dirs();
    spare.prepare("INSERT INTO source_images (object_id,file,thumb,width,height) VALUES (?,?,?,1,1)").run(A, `${A}.jpg`, `${A}.thumb.jpg`);
    writeFileSync(join(d.spareImages, `${A}.jpg`), "x"); writeFileSync(join(d.spareImages, `${A}.thumb.jpg`), "y");
    expect((bringBack(spare, live, "d", A, d) as any).images).toBe(2);
    expect(existsSync(join(d.liveImages, `${A}.jpg`))).toBe(true);
  });
  it("brings back an Object of a type the owner made, and the type with its properties if it was removed since (issue #107)", () => {
    const { spare, live } = world();
    for (const db of [spare]) {
      db.prepare("INSERT INTO object_types (key, label, plural, position, color, icon, core) VALUES ('x-book','Book','Books',5,'rose','book',0)").run();
      db.prepare("INSERT INTO field_definitions (key, label, input, options) VALUES ('c-1','Author','text',NULL)").run();
      db.prepare("INSERT INTO type_fields (type, field, position, lead) VALUES ('x-book','c-1',0,1)").run();
    }
    spare.prepare("UPDATE objects SET type = 'x-book' WHERE id = ?").run(C);
    spare.prepare("INSERT INTO field_values (object_id,field,value,origin) VALUES (?,'c-1','Frank','owner')").run(C);
    const r: any = bringBack(spare, live, "2026-11-10", C, { ...dirs() });
    expect(r.status).toBe("brought-back");
    expect(live.prepare("SELECT type FROM objects WHERE id = ?").get(C)).toEqual({ type: "x-book" });
    expect(live.prepare("SELECT label, color, icon, core FROM object_types WHERE key = 'x-book'").get()).toEqual({ label: "Book", color: "rose", icon: "book", core: 0 });
    expect(live.prepare("SELECT field, lead FROM type_fields WHERE type = 'x-book'").get()).toEqual({ field: "c-1", lead: 1 });
    expect(live.prepare("SELECT value FROM field_values WHERE object_id = ? AND field = 'c-1'").get(C)).toEqual({ value: "Frank" });
  });
});
