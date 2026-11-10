// Reading and writing Objects. Every value the owner types is saved with Origin "owner" (ADR 0001).
import { plainOf } from "../shared/markdown-doc.ts";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { MENTION, syncMentions } from "./mentions.ts";

type Db = Database.Database;

export const TAG_COLORS = ["blue", "rose", "olive", "amber", "sky", "lilac", "green", "peach", "indigo"] as const;

export class BadRequest extends Error {}

type OriginInfo = { origin: "source" | "ai" | "owner"; aiRole: string | null; aiModel: string | null; aiDate: string | null; approved: boolean };
// `approved` is only ever true for an AI piece the owner accepted as a Suggestion (it keeps AI Origin, shown ✧).
const originOf = (r: any): OriginInfo => ({ origin: r.origin, aiRole: r.ai_role, aiModel: r.ai_model, aiDate: r.ai_date, approved: r.origin === "ai" && !!r.approved });
const iso = (s: string | null) => (s ? s.replace(" ", "T") + "Z" : null);

export function listTypes(db: Db) {
  const types = db.prepare("SELECT key, label, plural, color, icon, core FROM object_types ORDER BY position").all() as any[];
  const used = new Map((db.prepare("SELECT type, count(*) AS total, coalesce(sum(deleted_at IS NOT NULL), 0) AS bin FROM objects GROUP BY type").all() as any[]).map((r) => [r.type as string, r]));
  const fields = db
    .prepare(
      `SELECT tf.type, tf.lead, fd.key, fd.label, fd.input, fd.options
       FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field ORDER BY tf.type, tf.position`,
    )
    .all() as any[];
  const all = db.prepare("SELECT key, label, input, options FROM field_definitions").all() as any[];
  const shape = (f: any) => ({ key: f.key, label: f.label, input: f.input, options: f.options ? JSON.parse(f.options) : null });
  return {
    types: types.map((t) => ({
      ...t,
      core: !!t.core,
      /** Objects of this type, and how many of those are in the Bin (a type with any cannot be removed). */
      count: (used.get(t.key)?.total ?? 0) - (used.get(t.key)?.bin ?? 0),
      inBin: used.get(t.key)?.bin ?? 0,
      fields: fields.filter((f) => f.type === t.key).map((f) => ({ ...shape(f), lead: !!f.lead })),
    })),
    fieldLabels: Object.fromEntries(all.map((f) => [f.key, shape(f)])),
  };
}

function typeExists(db: Db, type: unknown): type is string {
  return typeof type === "string" && !!db.prepare("SELECT 1 FROM object_types WHERE key = ?").get(type);
}

function tagsFor(db: Db, ids: string[]) {
  const rows = db
    .prepare(
      `SELECT ot.object_id, t.id, t.name, t.color, ot.origin, ot.ai_role, ot.ai_model, ot.ai_date
       FROM object_tags ot JOIN tags t ON t.id = ot.tag_id
       WHERE ot.object_id IN (${ids.map(() => "?").join(",") || "NULL"}) ORDER BY t.name`,
    )
    .all(...ids) as any[];
  const by = new Map<string, any[]>();
  for (const r of rows) {
    const list = by.get(r.object_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color, ...originOf(r) });
    by.set(r.object_id, list);
  }
  return by;
}

export function summarise(db: Db, rows: any[]) {
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",") || "NULL";
  const fields = db.prepare(`SELECT * FROM field_values WHERE object_id IN (${marks})`).all(...ids) as any[];
  const firstBlocks = db
    .prepare(`SELECT object_id, text FROM blocks WHERE object_id IN (${marks}) AND position = (SELECT min(position) FROM blocks b WHERE b.object_id = blocks.object_id)`)
    .all(...ids) as any[];
  const counts = db
    .prepare(
      `SELECT o.id AS id, count(c.id) AS n FROM objects o
       JOIN connections c ON (c.from_id = o.id OR c.to_id = o.id)
       JOIN objects other ON other.id = CASE WHEN c.from_id = o.id THEN c.to_id ELSE c.from_id END AND other.deleted_at IS NULL
       WHERE o.id IN (${marks}) GROUP BY o.id`,
    )
    .all(...ids) as any[];
  const withImage = new Set((db.prepare(`SELECT object_id FROM source_images WHERE object_id IN (${marks})`).all(...ids) as any[]).map((r) => r.object_id));
  const portraits = new Map((db.prepare(`SELECT object_id, stem FROM person_portraits WHERE object_id IN (${marks})`).all(...ids) as any[]).map((r) => [r.object_id, r.stem as string]));
  const tags = tagsFor(db, ids);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    private: !!r.private,
    unreviewed: !!r.unreviewed,
    hasImage: withImage.has(r.id),
    portrait: r.type === "person" ? (portraits.get(r.id) ?? null) : null, // a Person's Portrait (issue #69): the owner's photo, never sent to an AI
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at ?? r.created_at),
    fields: fields.filter((f) => f.object_id === r.id).map((f) => ({ key: f.field, value: f.value, ...originOf(f) })),
    firstLine: plainOf((firstBlocks.find((b) => b.object_id === r.id)?.text ?? "").replace(MENTION, "")).slice(0, 200),
    tags: tags.get(r.id) ?? [],
    connectionCount: counts.find((c) => c.id === r.id)?.n ?? 0,
  }));
}

/** The filters every list and the Search page share (issue #33): type, Tag, date, Unreviewed, No Connections yet. */
export type Filters = { type?: string; tag?: string; since?: string; until?: string; unreviewed?: string; noConnections?: string };
export const SORTS = ["relevance", "changed", "created", "title"] as const;
export type Sort = (typeof SORTS)[number];
const sqlTime = (iso: string) => iso.replace("T", " ").replace(/\.\d+Z$|Z$/, "");

/** SQL for the Objects a set of filters lets through (the table is called `o`). Bin Objects are never let through. */
export function filterSql(q: Filters) {
  const where = ["o.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (q.type) { where.push("o.type = ?"); args.push(q.type); }
  if (q.tag) { where.push("EXISTS (SELECT 1 FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = o.id AND t.name = ?)"); args.push(q.tag); }
  if (q.since) { where.push("coalesce(o.updated_at, o.created_at) >= ?"); args.push(sqlTime(q.since)); }
  if (q.until) { where.push("coalesce(o.updated_at, o.created_at) < ?"); args.push(sqlTime(q.until)); }
  if (q.unreviewed) where.push("o.unreviewed = 1");
  // "No Connections yet" counts only Connections to Objects that are still in the Garden (the same count the cards show).
  if (q.noConnections)
    where.push(`NOT EXISTS (SELECT 1 FROM connections c JOIN objects x ON x.id = CASE WHEN c.from_id = o.id THEN c.to_id ELSE c.from_id END AND x.deleted_at IS NULL WHERE c.from_id = o.id OR c.to_id = o.id)`);
  return { where: where.join(" AND "), args };
}

const nameOf = (s: { fields: { key: string; value: string }[]; firstLine: string }) => (s.fields.find((f) => f.key === "title")?.value || s.firstLine || "Untitled").toLowerCase();

export function listObjects(db: Db, q: Filters & { sort?: string }) {
  const f = filterSql(q);
  // Unreviewed is newest captured first; every other list goes by when it last changed, unless the owner picked an order.
  const created = q.sort === "created" || (q.unreviewed && !q.sort);
  const order = created ? "o.created_at DESC, o.rowid DESC" : "coalesce(o.updated_at, o.created_at) DESC, o.rowid DESC";
  const rows = db.prepare(`SELECT o.* FROM objects o WHERE ${f.where} ORDER BY ${order}`).all(...f.args);
  const out = summarise(db, rows);
  return q.sort === "title" ? out.sort((a, b) => nameOf(a).localeCompare(nameOf(b))) : out;
}

export function getObject(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) return null;
  const [summary] = summarise(db, [row]);
  const blocks = (db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(id) as any[]).map((b) => ({
    id: b.id, text: b.text, ...originOf(b),
  }));
  const r = row as any;
  return {
    ...summary,
    blocks,
    /** Set when the owner approved the Archivist's suggested change of Object Type. */
    typeAi: r.type_ai ? (JSON.parse(r.type_ai) as { aiRole: string; aiModel: string; aiDate: string }) : null,
    /** The day this became Private, when the AI had read it before that. */
    aiReadBeforePrivate: r.private ? ((r.ai_read_before_private as string | null) ?? null) : null,
  };
}

/** What an Object is called in a list or a sentence: its title, or for an untitled Thought its first line. */
export function titleOf(db: Db, id: string): string {
  const o = db.prepare("SELECT title FROM objects WHERE id = ?").get(id) as any;
  if (o?.title) return o.title;
  const b = db.prepare("SELECT text FROM blocks WHERE object_id = ? ORDER BY position LIMIT 1").get(id) as any;
  return (b?.text ?? "").replace(MENTION, "").trim().slice(0, 80) || "Untitled";
}

/** Delete (to the Bin): hidden from every view. Its Connections are kept but hidden, and Mentions of it read as missing. */
export function deleteObject(db: Db, id: string) {
  const r = db.prepare("UPDATE objects SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
  return r.changes > 0;
}

const touch = (db: Db, id: string) => db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);

function setField(db: Db, id: string, key: string, value: string | null) {
  if (!db.prepare("SELECT 1 FROM field_definitions WHERE key = ?").get(key) && key !== "title") throw new BadRequest(`unknown field ${key}`);
  const v = (value ?? "").trim();
  if (!v) {
    db.prepare("DELETE FROM field_values WHERE object_id = ? AND field = ?").run(id, key);
  } else {
    // Editing a value makes it the owner's (ADR 0001).
    db.prepare(
      `INSERT INTO field_values (object_id, field, value, origin) VALUES (?, ?, ?, 'owner')
       ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'owner', ai_role = NULL, ai_model = NULL, ai_date = NULL, approved = 0`,
    ).run(id, key, v);
  }
  if (key === "title") db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(v || null, id);
}

/**
 * Mark an Object Private, or not. Making it Private (CONTEXT.md: Private; issue #32): pending Suggestions about it, and
 * pending Suggestions to connect something to it, are dropped; its AI Notes are deleted; approved items stay; and if the
 * AI had read it before, the day is kept so the page can say so. Turning Private off starts nothing by itself.
 */
export function setPrivate(db: Db, id: string, on: boolean) {
  const o = db.prepare("SELECT private FROM objects WHERE id = ?").get(id) as any;
  if (!o) return;
  if (on && !o.private) {
    const read =
      db.prepare("SELECT 1 FROM ai_runs WHERE object_id = ? UNION ALL SELECT 1 FROM ai_notes WHERE object_id = ? UNION ALL SELECT 1 FROM ai_suggestions WHERE object_id = ? UNION ALL SELECT 1 FROM ai_jobs WHERE object_id = ? AND status = 'done' UNION ALL SELECT 1 FROM inquiry_turns WHERE instr(coalesce(read_ids, ''), ?) > 0 LIMIT 1").get(id, id, id, id, `"${id}"`);
    db.prepare("DELETE FROM ai_suggestions WHERE object_id = ? OR (kind IN ('connection', 'object') AND json_extract(data, '$.otherId') = ?)").run(id, id);
    db.prepare("DELETE FROM ai_notes WHERE object_id = ?").run(id);
    db.prepare("UPDATE ai_jobs SET status = 'cancelled' WHERE object_id = ? AND status IN ('waiting', 'busy', 'tomorrow')").run(id);
    db.prepare("UPDATE objects SET private = 1, ai_read_before_private = ? WHERE id = ?").run(read ? new Date().toISOString().slice(0, 10) : null, id);
  } else if (!on) {
    db.prepare("UPDATE objects SET private = 0 WHERE id = ?").run(id);
  }
}

export function createObject(db: Db, input: { type?: unknown; title?: unknown; private?: unknown }) {
  if (!typeExists(db, input.type)) throw new BadRequest("unknown Object Type");
  const id = randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO objects (id, type, private, updated_at) VALUES (?, ?, ?, datetime('now'))").run(id, input.type, input.private ? 1 : 0);
    if (typeof input.title === "string") setField(db, id, "title", input.title);
  })();
  return getObject(db, id)!;
}

export function updateObject(db: Db, id: string, patch: { type?: unknown; private?: unknown; fields?: unknown }) {
  if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(id)) return null;
  db.transaction(() => {
    if (patch.type !== undefined) {
      if (!typeExists(db, patch.type)) throw new BadRequest("unknown Object Type");
      // Only the type changes. Field values that don't fit the new type stay stored.
      // Choosing a type is the owner's decision, so it stops being the Archivist's.
      db.prepare("UPDATE objects SET type = ?, type_ai = CASE WHEN type = ? THEN type_ai ELSE NULL END WHERE id = ?").run(patch.type, patch.type, id);
    }
    if (patch.private !== undefined) setPrivate(db, id, !!patch.private);
    if (patch.fields !== undefined) {
      if (typeof patch.fields !== "object" || patch.fields === null) throw new BadRequest("fields must be an object");
      for (const [k, v] of Object.entries(patch.fields)) setField(db, id, k, v === null ? null : String(v));
    }
    touch(db, id);
  })();
  return getObject(db, id);
}

/** Replace the owner's paragraphs. Blocks from the Source (Quotes) are left alone. */
export function setBody(db: Db, id: string, paragraphs: unknown) {
  if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(id)) return null;
  if (!Array.isArray(paragraphs) || paragraphs.some((p) => typeof p !== "string")) throw new BadRequest("paragraphs must be a list of text");
  const mine = (paragraphs as string[]).map((p) => p.trim()).filter(Boolean);
  db.transaction(() => {
    db.prepare("DELETE FROM blocks WHERE object_id = ? AND origin = 'owner'").run(id);
    const max = (db.prepare("SELECT coalesce(max(position), -1) AS m FROM blocks WHERE object_id = ?").get(id) as any).m;
    const ins = db.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, ?, ?, 'owner')");
    mine.forEach((text, i) => ins.run(id, max + 1 + i, text));
    syncMentions(db, id);
    touch(db, id);
  })();
  return getObject(db, id);
}

export function listTags(db: Db) {
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, count(o.id) AS count FROM tags t
       LEFT JOIN object_tags ot ON ot.tag_id = t.id
       LEFT JOIN objects o ON o.id = ot.object_id AND o.deleted_at IS NULL
       GROUP BY t.id ORDER BY t.name`,
    )
    .all();
}

export const cleanTagName = (name: unknown) =>
  typeof name === "string" ? name.trim().replace(/^#+/, "").trim().toLowerCase().replace(/\s+/g, "-") : "";

/** The Tag with this (already cleaned) name, made if it doesn't exist yet. Each new Tag gets the next colour in turn, so neighbours differ. */
export function tagIdFor(db: Db, clean: string): number {
  const tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(clean) as any;
  if (tag) return tag.id;
  const n = (db.prepare("SELECT count(*) AS n FROM tags").get() as any).n;
  return Number(db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(clean, TAG_COLORS[n % TAG_COLORS.length]).lastInsertRowid);
}

export function addTag(db: Db, objectId: string, name: unknown) {
  const clean = cleanTagName(name);
  if (!clean) throw new BadRequest("a Tag needs a name");
  if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(objectId)) return null;
  db.transaction(() => {
    const tagId = tagIdFor(db, clean);
    db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin) VALUES (?, ?, 'owner')").run(objectId, tagId);
    // The owner putting back a Tag the AI once suggested here: it is no longer "turned down".
    db.prepare("DELETE FROM ai_rejected WHERE object_id = ? AND kind = 'tag' AND value = ?").run(objectId, clean);
    touch(db, objectId);
  })();
  return getObject(db, objectId);
}

export function removeTag(db: Db, objectId: string, tagId: number) {
  // Removing a Tag the AI added is remembered, so the Archivist does not suggest it again (CONTEXT.md: Suggestion).
  const was = db.prepare("SELECT t.name, ot.origin FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ? AND ot.tag_id = ?").get(objectId, tagId) as any;
  if (was?.origin === "ai") db.prepare("INSERT OR IGNORE INTO ai_rejected (object_id, kind, value) VALUES (?, 'tag', ?)").run(objectId, was.name);
  db.prepare("DELETE FROM object_tags WHERE object_id = ? AND tag_id = ?").run(objectId, tagId);
  touch(db, objectId);
  return getObject(db, objectId);
}

export function setTagColor(db: Db, tagId: number, color: unknown) {
  if (!TAG_COLORS.includes(color as any)) throw new BadRequest("unknown colour");
  db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, tagId);
  return listTags(db);
}

/** The owner's tick that they have looked at these. It approves and rejects nothing (issue #16). */
export function markReviewed(db: Db, ids: unknown) {
  if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string")) throw new BadRequest("ids must be a list");
  const upd = db.prepare("UPDATE objects SET unreviewed = 0 WHERE id = ? AND unreviewed = 1");
  db.transaction(() => { for (const id of ids as string[]) upd.run(id); })();
  return { reviewed: ids.length };
}
