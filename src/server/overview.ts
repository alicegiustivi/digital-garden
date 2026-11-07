// The Overview (issue #34): Concepts as islands sized by what is connected straight to them (CONTEXT.md: Concept), a shelf of
// loose Objects, and Turn into Concept. Everything here is the owner's own view of the Garden, so Private Objects are
// included; nothing here calls an AI or leaves the Mac.
import type Database from "better-sqlite3";
import { BadRequest, createObject, listTags, titleOf } from "./objects.ts";
import { deleteTag, purgeObjects } from "./bin.ts";

type Db = Database.Database;
const WEEK = 7 * 864e5;
const brief = (r: any) => ({ id: r.id as string, type: r.type as string, title: titleOf(r.db, r.id), private: !!r.private });

/** The live Objects connected straight to one Object (Bin Objects are hidden). */
const neighbours = (db: Db, id: string) =>
  db
    .prepare(
      `SELECT o.id, o.type, o.private, coalesce(o.updated_at, o.created_at) AS changed FROM connections c
       JOIN objects o ON o.id = CASE WHEN c.from_id = ? THEN c.to_id ELSE c.from_id END AND o.deleted_at IS NULL
       WHERE c.from_id = ? OR c.to_id = ?`,
    )
    .all(id, id, id) as any[];

export function overview(db: Db, now = Date.now()) {
  const concepts = db.prepare("SELECT id, private FROM objects WHERE type = 'concept' AND deleted_at IS NULL").all() as any[];
  const islands = concepts.map((c) => {
    const near = neighbours(db, c.id).filter((n) => n.id !== c.id);
    const mix: Record<string, number> = {};
    for (const n of near) mix[n.type] = (mix[n.type] ?? 0) + 1;
    // 8 weekly dots, oldest first: how many connected Objects were made or changed in each of the last 8 weeks.
    const weeks = Array<number>(8).fill(0);
    for (const n of near) {
      const t = Date.parse(String(n.changed).replace(" ", "T") + "Z");
      const ago = Math.floor((now - t) / WEEK);
      if (ago >= 0 && ago < 8) weeks[7 - ago]++;
    }
    const recent = [...near].sort((a, b) => String(b.changed).localeCompare(String(a.changed))).slice(0, 3).map((n) => brief({ ...n, db }));
    return { id: c.id as string, title: titleOf(db, c.id), private: !!c.private, size: near.length, mix, weeks, recent, lastChanged: near.reduce((m, n) => (String(n.changed) > m ? String(n.changed) : m), "") };
  });
  islands.sort((a, b) => b.size - a.size || a.title.localeCompare(b.title));

  // Objects that sit in more than one Concept (only Connections straight to a Concept count).
  const inConcepts = new Map<string, string[]>();
  for (const c of concepts)
    for (const n of neighbours(db, c.id)) if (n.type !== "concept") inConcepts.set(n.id, [...(inConcepts.get(n.id) ?? []), c.id]);
  const titleById = new Map(islands.map((i) => [i.id, i.title]));
  const several = [...inConcepts.entries()]
    .filter(([, cs]) => cs.length > 1)
    .map(([id, cs]) => {
      const o = db.prepare("SELECT id, type, private FROM objects WHERE id = ?").get(id) as any;
      return { ...brief({ ...o, db }), concepts: cs.map((x) => ({ id: x, title: titleById.get(x) ?? "" })) };
    })
    .sort((a, b) => b.concepts.length - a.concepts.length || a.title.localeCompare(b.title));

  // The shelf: Objects (other than Concepts) not connected straight to any Concept yet, newest first.
  const loose = (db.prepare("SELECT o.id, o.type, o.private FROM objects o WHERE o.deleted_at IS NULL AND o.type <> 'concept' ORDER BY coalesce(o.updated_at, o.created_at) DESC, o.rowid DESC").all() as any[]).filter((o) => !inConcepts.has(o.id));
  const shelf = loose.slice(0, 60).map((o) => ({ ...brief({ ...o, db }), tags: (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ? ORDER BY t.name").all(o.id) as any[]).map((t) => t.name) }));

  // With no Concepts yet, the biggest Tags stand in as dashed islands.
  const dashed = islands.length ? [] : listTags(db).filter((t: any) => t.count > 0).sort((a: any, b: any) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 12);
  return { islands, several, shelf, shelfTotal: loose.length, dashed };
}

/** Which islands share Tags with one loose Object: what to light up. Tags only, by name; no AI. */
export function lightUp(db: Db, id: string) {
  const o = db.prepare("SELECT id FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!o) return null;
  const mine = (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[]).map((r) => r.name as string);
  const concepts = (db.prepare("SELECT id FROM objects WHERE type = 'concept' AND deleted_at IS NULL AND id <> ?").all(id) as any[]).map((r) => r.id as string);
  const tagsOn = db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?");
  const islands: { id: string; shared: string[]; connected: boolean }[] = [];
  for (const cid of concepts) {
    const have = new Set<string>();
    for (const n of [{ id: cid }, ...neighbours(db, cid)]) for (const t of tagsOn.all(n.id) as any[]) if (mine.includes(t.name)) have.add(t.name);
    const connected = !!db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, cid, cid, id);
    if (have.size || connected) islands.push({ id: cid, shared: [...have].sort(), connected });
  }
  return { tags: mine, islands: islands.sort((a, b) => b.shared.length - a.shared.length) };
}

/**
 * Turn a Tag into a Concept. The Concept is the owner's (they asked for it, and its name is the Tag's name), it is not
 * Unreviewed, and every live Object carrying the Tag is connected to it as "related" with Owner Origin. By default the
 * Tag is then removed; the answer carries everything Undo needs.
 */
export function turnIntoConcept(db: Db, tagId: number, opts: { removeTag?: unknown } = {}) {
  const tag = db.prepare("SELECT id, name FROM tags WHERE id = ?").get(tagId) as any;
  if (!tag) return null;
  const remove = opts.removeTag !== false;
  return db.transaction(() => {
    const concept = createObject(db, { type: "concept", title: tag.name });
    const carriers = db
      .prepare("SELECT o.id FROM object_tags ot JOIN objects o ON o.id = ot.object_id AND o.deleted_at IS NULL WHERE ot.tag_id = ? ORDER BY o.rowid")
      .all(tagId) as any[];
    const connections: number[] = [];
    for (const c of carriers) {
      const r = db.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'related', 'owner')").run(concept.id, c.id);
      connections.push(Number(r.lastInsertRowid));
    }
    const removed = remove ? deleteTag(db, tagId) : null;
    return { concept: { id: concept.id as string, title: tag.name as string }, connected: connections.length, connections, removed };
  })();
}

/** Undo Turn into Concept: put the Tag back, then drop the Concept and the Connections it made, for good. */
export function undoTurnIntoConcept(db: Db, input: any, restoreTag: (db: Db, r: any) => unknown) {
  const id = input?.conceptId;
  if (typeof id !== "string" || !db.prepare("SELECT 1 FROM objects WHERE id = ? AND type = 'concept'").get(id)) throw new BadRequest("nothing to undo");
  db.transaction(() => {
    if (input.removed) restoreTag(db, input.removed);
    db.prepare("UPDATE objects SET deleted_at = datetime('now') WHERE id = ?").run(id); // purging only takes Bin Objects
    purgeObjects(db, [id]);
  })();
  return { undone: true };
}
