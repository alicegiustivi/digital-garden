// Reading and writing Objects. Every value the owner types is saved with Origin "owner" (ADR 0001).
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

type Db = Database.Database;

export const TAG_COLORS = ["blue", "rose", "olive", "amber", "sky", "lilac", "green", "peach", "indigo"] as const;

export class BadRequest extends Error {}

type OriginInfo = { origin: "source" | "ai" | "owner"; aiRole: string | null; aiModel: string | null; aiDate: string | null };
const originOf = (r: any): OriginInfo => ({ origin: r.origin, aiRole: r.ai_role, aiModel: r.ai_model, aiDate: r.ai_date });
const iso = (s: string | null) => (s ? s.replace(" ", "T") + "Z" : null);

export function listTypes(db: Db) {
  const types = db.prepare("SELECT key, label, plural FROM object_types ORDER BY position").all() as any[];
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

function summarise(db: Db, rows: any[]) {
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
       WHERE o.id IN (${marks}) GROUP BY o.id`,
    )
    .all(...ids) as any[];
  const tags = tagsFor(db, ids);
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    private: !!r.private,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at ?? r.created_at),
    fields: fields.filter((f) => f.object_id === r.id).map((f) => ({ key: f.field, value: f.value, ...originOf(f) })),
    firstLine: (firstBlocks.find((b) => b.object_id === r.id)?.text ?? "").slice(0, 200),
    tags: tags.get(r.id) ?? [],
    connectionCount: counts.find((c) => c.id === r.id)?.n ?? 0,
  }));
}

export function listObjects(db: Db, q: { type?: string; tag?: string; since?: string }) {
  const where = ["o.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (q.type) { where.push("o.type = ?"); args.push(q.type); }
  if (q.tag) { where.push("EXISTS (SELECT 1 FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = o.id AND t.name = ?)"); args.push(q.tag); }
  if (q.since) { where.push("coalesce(o.updated_at, o.created_at) >= ?"); args.push(q.since.replace("T", " ").replace(/\.\d+Z$|Z$/, "")); }
  const rows = db
    .prepare(`SELECT o.* FROM objects o WHERE ${where.join(" AND ")} ORDER BY coalesce(o.updated_at, o.created_at) DESC, o.rowid DESC`)
    .all(...args);
  return summarise(db, rows);
}

export function getObject(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);
  if (!row) return null;
  const [summary] = summarise(db, [row]);
  const blocks = (db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(id) as any[]).map((b) => ({
    id: b.id, text: b.text, ...originOf(b),
  }));
  return { ...summary, blocks };
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
       ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'owner', ai_role = NULL, ai_model = NULL, ai_date = NULL`,
    ).run(id, key, v);
  }
  if (key === "title") db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(v || null, id);
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
      db.prepare("UPDATE objects SET type = ? WHERE id = ?").run(patch.type, id);
    }
    if (patch.private !== undefined) db.prepare("UPDATE objects SET private = ? WHERE id = ?").run(patch.private ? 1 : 0, id);
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

export function addTag(db: Db, objectId: string, name: unknown) {
  const clean = cleanTagName(name);
  if (!clean) throw new BadRequest("a Tag needs a name");
  if (!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(objectId)) return null;
  db.transaction(() => {
    let tag = db.prepare("SELECT id FROM tags WHERE name = ?").get(clean) as any;
    if (!tag) {
      // Each new Tag gets the next colour in turn, so neighbours differ.
      const n = (db.prepare("SELECT count(*) AS n FROM tags").get() as any).n;
      const color = TAG_COLORS[n % TAG_COLORS.length];
      tag = { id: db.prepare("INSERT INTO tags (name, color) VALUES (?, ?)").run(clean, color).lastInsertRowid };
    }
    db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin) VALUES (?, ?, 'owner')").run(objectId, tag.id);
    touch(db, objectId);
  })();
  return getObject(db, objectId);
}

export function removeTag(db: Db, objectId: string, tagId: number) {
  db.prepare("DELETE FROM object_tags WHERE object_id = ? AND tag_id = ?").run(objectId, tagId);
  touch(db, objectId);
  return getObject(db, objectId);
}

export function setTagColor(db: Db, tagId: number, color: unknown) {
  if (!TAG_COLORS.includes(color as any)) throw new BadRequest("unknown colour");
  db.prepare("UPDATE tags SET color = ? WHERE id = ?").run(color, tagId);
  return listTags(db);
}
