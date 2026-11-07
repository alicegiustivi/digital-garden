// Renaming and merging Tags (issue #33). Both hand back what they changed so the page can offer Undo, like the other removals.
import type Database from "better-sqlite3";
import { BadRequest, cleanTagName, listTags } from "./objects.ts";

type Db = Database.Database;
type Row = { objectId: string; origin: string; aiRole: string | null; aiModel: string | null; aiDate: string | null };
const rowsOf = (db: Db, tagId: number): Row[] =>
  (db.prepare("SELECT object_id, origin, ai_role, ai_model, ai_date FROM object_tags WHERE tag_id = ?").all(tagId) as any[]).map((r) => ({ objectId: r.object_id, origin: r.origin, aiRole: r.ai_role, aiModel: r.ai_model, aiDate: r.ai_date }));
const putRow = (db: Db, tagId: number, r: Row) =>
  db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) VALUES (?, ?, ?, ?, ?, ?)").run(r.objectId, tagId, r.origin, r.aiRole, r.aiModel, r.aiDate);
/** Things the owner turned down are remembered by Tag name, so they follow the name. */
const moveRejected = (db: Db, from: string, to: string) => {
  db.prepare("UPDATE OR IGNORE ai_rejected SET value = ? WHERE kind = 'tag' AND value = ?").run(to, from);
  db.prepare("DELETE FROM ai_rejected WHERE kind = 'tag' AND value = ?").run(from);
};

/**
 * Give a Tag a new name. The owner typed the new name, so it is the owner's wherever the Tag is used (ADR 0001: editing a
 * short value makes it the owner's). A name already taken is refused: that is what Merge is for.
 */
export function renameTag(db: Db, tagId: number, name: unknown) {
  const tag = db.prepare("SELECT id, name FROM tags WHERE id = ?").get(tagId) as any;
  if (!tag) return null;
  const clean = cleanTagName(name);
  if (!clean) throw new BadRequest("a Tag needs a name");
  const was = { name: tag.name as string, on: rowsOf(db, tagId) };
  if (clean === tag.name) return { tags: listTags(db), was };
  if (db.prepare("SELECT 1 FROM tags WHERE name = ?").get(clean)) throw new BadRequest(`There is already a Tag called #${clean}. Use Merge to combine the two.`);
  db.transaction(() => {
    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(clean, tagId);
    db.prepare("UPDATE object_tags SET origin = 'owner', ai_role = NULL, ai_model = NULL, ai_date = NULL WHERE tag_id = ?").run(tagId);
    moveRejected(db, tag.name, clean);
  })();
  return { tags: listTags(db), was };
}

export function undoRename(db: Db, tagId: number, was: any) {
  if (!db.prepare("SELECT 1 FROM tags WHERE id = ?").get(tagId)) throw new BadRequest("That Tag no longer exists");
  const clean = cleanTagName(was?.name);
  if (!clean || !Array.isArray(was?.on)) throw new BadRequest("nothing to undo");
  if (db.prepare("SELECT 1 FROM tags WHERE name = ? AND id <> ?").get(clean, tagId)) throw new BadRequest(`There is already a Tag called #${clean}`);
  db.transaction(() => {
    db.prepare("UPDATE tags SET name = ? WHERE id = ?").run(clean, tagId);
    for (const r of was.on as Row[]) db.prepare("UPDATE object_tags SET origin = ?, ai_role = ?, ai_model = ?, ai_date = ? WHERE tag_id = ? AND object_id = ?").run(r.origin, r.aiRole, r.aiModel, r.aiDate, tagId, r.objectId);
  })();
  return listTags(db);
}

/** Fold one Tag into another: everything that carried it carries the other, then the first is gone. Each keeps the Origin it had. */
export function mergeTags(db: Db, fromId: number, intoId: number) {
  const from = db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(fromId) as any;
  const into = db.prepare("SELECT id, name, color FROM tags WHERE id = ?").get(intoId) as any;
  if (!from || !into) return null;
  if (fromId === intoId) throw new BadRequest("Pick a different Tag to merge into");
  const on = rowsOf(db, fromId);
  const had = new Set(rowsOf(db, intoId).map((r) => r.objectId));
  const added = on.filter((r) => !had.has(r.objectId)).map((r) => r.objectId);
  db.transaction(() => {
    for (const r of on) putRow(db, intoId, r);
    db.prepare("DELETE FROM object_tags WHERE tag_id = ?").run(fromId);
    db.prepare("DELETE FROM tags WHERE id = ?").run(fromId);
    moveRejected(db, from.name, into.name);
  })();
  return { tags: listTags(db), merged: { from, into, on, added } };
}

export function undoMerge(db: Db, m: any) {
  const { from, into, on, added } = m ?? {};
  if (!from || typeof from.name !== "string" || !into || !Array.isArray(on) || !Array.isArray(added)) throw new BadRequest("nothing to undo");
  if (db.prepare("SELECT 1 FROM tags WHERE name = ?").get(from.name)) throw new BadRequest("A Tag with that name exists again");
  db.transaction(() => {
    db.prepare("INSERT INTO tags (id, name, color) VALUES (?, ?, ?)").run(from.id, from.name, from.color);
    for (const r of on as Row[]) if (db.prepare("SELECT 1 FROM objects WHERE id = ?").get(r.objectId)) putRow(db, from.id, r);
    for (const id of added as string[]) db.prepare("DELETE FROM object_tags WHERE tag_id = ? AND object_id = ?").run(into.id, id);
  })();
  return listTags(db);
}
