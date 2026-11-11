// The Bin (issue #30): where a deleted Object waits 30 days before it is gone for good (CONTEXT.md: Bin).
// Deleting only stamps `deleted_at`, so everything about the Object (fields, body, Tags, Connections) is still in the
// database, just hidden. Restoring clears the stamp. Purging really removes it.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { BadRequest, summarise, titleOf } from "./objects.ts";
import { imagesDir } from "./paths.ts";
import { dropPortraitFiles } from "./portraits.ts";
import { dropPropImageFiles } from "./prop-images.ts";
import { mentionToken, syncMentions } from "./mentions.ts";
import { emptyInquiryBin, purgeExpiredInquiries } from "./researcher.ts";

type Db = Database.Database;
export const BIN_DAYS = 30;

/** Everything in the Bin, most recently deleted first, with how many days it has left. */
export function listBin(db: Db) {
  purgeExpired(db);
  const rows = db.prepare("SELECT * FROM objects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, rowid DESC").all() as any[];
  const summaries = summarise(db, rows);
  const count = db.prepare("SELECT count(*) AS n FROM connections WHERE from_id = ? OR to_id = ?");
  return rows.map((r, i) => {
    const days = Math.max(0, Math.ceil(BIN_DAYS - (Date.now() - Date.parse(r.deleted_at.replace(" ", "T") + "Z")) / 864e5));
    const n = (count.get(r.id, r.id) as any).n;
    return { ...summaries[i], title: titleOf(db, r.id), deletedAt: r.deleted_at.replace(" ", "T") + "Z", daysLeft: days, connectionCount: n };
  });
}

/** Put it back exactly as it was. Its Connections reappear because they were never removed. */
export function restoreObject(db: Db, id: string) {
  const r = db.prepare("UPDATE objects SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").run(id);
  if (!r.changes) return false;
  // Any body that mentions it should have its Connection again (it is normally still there; this only mends a gap).
  for (const b of db.prepare("SELECT DISTINCT object_id FROM blocks WHERE instr(text, ?) > 0").all(mentionToken(id)) as any[]) syncMentions(db, b.object_id);
  return true;
}

/** Remove one Object from the Garden for good, with its Connections. Mentions of it in other bodies stay as text and read "missing". */
export function purgeObjects(db: Db, ids: string[]) {
  const gone: string[] = [];
  db.transaction(() => {
    for (const id of ids) {
      if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NOT NULL").get(id)) continue; // only the Bin can be purged
      for (const table of ["connections"]) db.prepare(`DELETE FROM ${table} WHERE from_id = ? OR to_id = ?`).run(id, id);
      db.prepare("DELETE FROM ai_suggestions WHERE json_extract(data, '$.otherId') = ?").run(id);
      for (const table of ["object_tags", "field_values", "blocks", "source_images", "person_portraits", "property_images", "ai_jobs", "ai_runs", "ai_rejected", "ai_notes", "ai_suggestions", "concept_versions", "open_questions", "garden_dismissed"]) db.prepare(`DELETE FROM ${table} WHERE object_id = ?`).run(id);
      db.prepare("UPDATE open_questions SET settled_by = NULL WHERE settled_by = ?").run(id);
      db.prepare("DELETE FROM objects WHERE id = ?").run(id);
      gone.push(id);
    }
  })();
  // Picture files are removed after the database commit; a failure here only leaves a stray file.
  for (const id of gone) void dropPortraitFiles(db, id);
  for (const id of gone) void dropPropImageFiles(db, id);
  for (const id of gone) for (const f of [`${id}.jpg`, `${id}.thumb.jpg`]) void rm(join(imagesDir(), f), { force: true }).catch(() => {});
  return gone.length;
}

export const emptyBin = (db: Db) => purgeObjects(db, (db.prepare("SELECT id FROM objects WHERE deleted_at IS NOT NULL").all() as any[]).map((r) => r.id)) + emptyInquiryBin(db);

/** Anything that has been in the Bin for 30 days goes for good. */
export function purgeExpired(db: Db) {
  const old = db.prepare(`SELECT id FROM objects WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-${BIN_DAYS} days')`).all() as any[];
  return purgeObjects(db, old.map((r) => r.id)) + purgeExpiredInquiries(db);
}

// Undo for the small removals (a Connection, a Tag): the page keeps what was removed and hands it back to be put in again.
const ORIGINS = ["source", "ai", "owner"];
const originCols = (o: any) => {
  if (!ORIGINS.includes(o?.origin)) throw new BadRequest("origin is needed");
  return [o.origin, o.aiRole ?? null, o.aiModel ?? null, o.aiDate ?? null] as const;
};

export function restoreConnection(db: Db, c: any) {
  const live = (id: unknown) => typeof id === "string" && db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!live(c?.fromId) || !live(c?.toId)) throw new BadRequest("That Object could not be found");
  if (db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(c.fromId, c.toId, c.toId, c.fromId))
    throw new BadRequest("These two are already connected");
  db.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date, note, approved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(c.fromId, c.toId, String(c.kind), ...originCols(c), c.note ?? null, c.origin === "ai" && c.approved ? 1 : 0);
  return { restored: true };
}

export function restoreTagOn(db: Db, objectId: string, tagId: number, origin: unknown) {
  if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(objectId)) return false;
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ?").get(tagId)) throw new BadRequest("That Tag no longer exists");
  db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) VALUES (?, ?, ?, ?, ?, ?)").run(objectId, tagId, ...originCols(origin));
  // Undoing the removal of an AI Tag means it is no longer "turned down".
  db.prepare("DELETE FROM ai_rejected WHERE object_id = ? AND kind = 'tag' AND value = (SELECT name FROM tags WHERE id = ?)").run(objectId, tagId);
  return true;
}

/** Remove a Tag from the whole Garden. Hands back exactly what was removed so Undo can put it all back. */
export function deleteTag(db: Db, tagId: number) {
  const tag = db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(tagId) as any;
  if (!tag) return null;
  const on = db.prepare("SELECT object_id, origin, ai_role, ai_model, ai_date FROM object_tags WHERE tag_id = ?").all(tagId) as any[];
  const live = (db.prepare("SELECT count(*) AS n FROM object_tags ot JOIN objects o ON o.id = ot.object_id AND o.deleted_at IS NULL WHERE ot.tag_id = ?").get(tagId) as any).n;
  // Only an AI Tag counts as turned down (so the Archivist does not put it back); a Tag the owner made is simply gone.
  const turnedDown: string[] = [];
  db.transaction(() => {
    for (const r of on) if (r.origin === "ai" && db.prepare("INSERT OR IGNORE INTO ai_rejected (object_id, kind, value) VALUES (?, 'tag', ?)").run(r.object_id, tag.name).changes) turnedDown.push(r.object_id);
    db.prepare("DELETE FROM object_tags WHERE tag_id = ?").run(tagId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(tagId);
  })();
  return { tag, objects: live, turnedDown, on: on.map((r) => ({ objectId: r.object_id, origin: r.origin, aiRole: r.ai_role, aiModel: r.ai_model, aiDate: r.ai_date })) };
}

export function restoreTag(db: Db, input: any) {
  const { tag, on } = input ?? {};
  const turnedDown: unknown[] = Array.isArray(input?.turnedDown) ? input.turnedDown : [];
  if (!tag || typeof tag.name !== "string" || !Array.isArray(on)) throw new BadRequest("nothing to restore");
  if (db.prepare("SELECT 1 FROM tags WHERE name = ?").get(tag.name)) throw new BadRequest("A Tag with that name exists again");
  db.transaction(() => {
    db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(tag.id, tag.name, tag.color);
    for (const r of on) {
      if (!db.prepare("SELECT 1 FROM objects WHERE id = ?").get(r.objectId)) continue;
      db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) VALUES (?, ?, ?, ?, ?, ?)").run(r.objectId, tag.id, ...originCols(r));
    }
    // Undo also forgets the "turned down" note that the removal made.
    for (const id of turnedDown) if (typeof id === "string") db.prepare("DELETE FROM ai_rejected WHERE object_id = ? AND kind = 'tag' AND value = ?").run(id, tag.name);
  })();
  return { restored: true };
}
