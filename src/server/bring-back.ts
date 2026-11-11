// "Bring back X from Monday's Backup" (issue #41).
// Copies ONE Object out of a Backup that was restored into a spare folder, into the live Garden.
// Everything keeps its Origin exactly as it was; the only new thing is an owner Tag "restored-<day>".
import Database from "better-sqlite3";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { cleanTagName, tagIdFor } from "./objects.ts";

type Db = Database.Database;
export type Match = { id: string; type: string; title: string; deleted: boolean };
export type BringBackResult =
  | { status: "brought-back"; id: string; title: string; tag: string; tables: Record<string, number>; images: number; connectionsSkipped: number }
  | { status: "several"; matches: Match[] }
  | { status: "not-found" }
  | { status: "already-there"; id: string; inBin: boolean };

const titleOf = (db: Db, id: string): string => {
  const o = db.prepare("SELECT title FROM objects WHERE id = ?").get(id) as any;
  if (o?.title) return o.title;
  const b = db.prepare("SELECT text FROM blocks WHERE object_id = ? ORDER BY position LIMIT 1").get(id) as any;
  return (b?.text ?? "").replace(/\[\[o:[^\]]*\]\]/g, "").trim().slice(0, 80) || "Untitled";
};

/** Objects in the spare copy that match an id or some words of the title (the Bin is searched too). */
export function findInSpare(spare: Db, query: string): Match[] {
  const q = query.trim();
  const rows = spare.prepare("SELECT id, type, title, deleted_at FROM objects").all() as any[];
  const all = rows.map((r) => ({ id: r.id as string, type: r.type as string, title: titleOf(spare, r.id), deleted: !!r.deleted_at }));
  const byId = all.filter((m) => m.id === q);
  if (byId.length) return byId;
  const exact = all.filter((m) => m.title.toLowerCase() === q.toLowerCase());
  if (exact.length) return exact;
  return all.filter((m) => m.title.toLowerCase().includes(q.toLowerCase()));
}

const columns = (db: Db, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name as string);
const has = (db: Db, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);

/** Copy rows of `table` where `where` matches, keeping every column both databases have. `skipId` lets the live database number new rows itself. */
function copyRows(spare: Db, live: Db, table: string, where: string, arg: unknown, skipId = false, extra: Record<string, unknown> = {}): number {
  if (!has(spare, table) || !has(live, table)) return 0;
  const liveCols = new Set(columns(live, table));
  const cols = columns(spare, table).filter((c) => liveCols.has(c) && !(skipId && c === "id"));
  const rows = spare.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(",")} FROM ${table} WHERE ${where}`).all(arg) as any[];
  const ins = live.prepare(`INSERT OR IGNORE INTO ${table} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  let n = 0;
  for (const r of rows) n += ins.run(cols.map((c) => (c in extra ? extra[c] : r[c]))).changes;
  return n;
}

export function bringBack(spare: Db, live: Db, day: string, query: string, opts: { spareImages: string; liveImages: string; id?: string; lookOnly?: boolean }): BringBackResult | { status: "would"; match: Match } {
  const matches = opts.id ? findInSpare(spare, opts.id) : findInSpare(spare, query);
  if (!matches.length) return { status: "not-found" };
  if (matches.length > 1) return { status: "several", matches };
  const m = matches[0];
  const there = live.prepare("SELECT deleted_at FROM objects WHERE id = ?").get(m.id) as any;
  if (there) return { status: "already-there", id: m.id, inBin: !!there.deleted_at };
  if (opts.lookOnly) return { status: "would", match: m };

  const tag = cleanTagName(`restored ${day}`);
  const tables: Record<string, number> = {};
  let images = 0, connectionsSkipped = 0;
  live.transaction(() => {
    // The Object comes back as it was. It is not "Unreviewed" again and is not in the Bin, even if it was when the Backup was made.
    // An Object of a type the owner made needs that type (and its properties) to be here: bring them back if the type was removed since.
    if (!live.prepare("SELECT 1 FROM object_types WHERE key = ?").get(m.type)) {
      copyRows(spare, live, "object_types", "key = ?", m.type);
      const fields = (spare.prepare("SELECT field FROM type_fields WHERE type = ?").all(m.type) as any[]).map((r) => r.field as string);
      for (const f of fields) copyRows(spare, live, "field_definitions", "key = ?", f);
      copyRows(spare, live, "type_fields", "type = ?", m.type);
    }
    tables.objects = copyRows(spare, live, "objects", "id = ?", m.id, false, { deleted_at: null });
    for (const t of ["field_values", "blocks", "ai_notes", "open_questions", "concept_versions", "source_images", "person_portraits", "property_images"]) {
      tables[t] = copyRows(spare, live, t, "object_id = ?", m.id, t === "field_values" || t === "blocks" || t === "ai_notes");
    }
    // Tags are matched by name, so the Garden's own Tag colours win; Tags that are gone are made again.
    const tags = spare.prepare("SELECT t.name, ot.* FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(m.id) as any[];
    for (const t of tags) {
      live.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) VALUES (?,?,?,?,?,?)")
        .run(m.id, tagIdFor(live, t.name), t.origin, t.ai_role, t.ai_model, t.ai_date);
    }
    tables.tags = tags.length;
    // Connections come back only when the Object at the other end is in the Garden now.
    const conns = spare.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ?").all(m.id, m.id) as any[];
    const cols = columns(live, "connections").filter((c) => c !== "id");
    for (const c of conns) {
      const other = c.from_id === m.id ? c.to_id : c.from_id;
      if (!live.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(other)) { connectionsSkipped++; continue; }
      live.prepare(`INSERT OR IGNORE INTO connections (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(cols.map((k) => c[k]));
    }
    tables.connections = conns.length - connectionsSkipped;
    // The mark: an owner Tag, because the owner asked for this.
    live.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin) VALUES (?,?, 'owner')").run(m.id, tagIdFor(live, tag));
    live.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(m.id);
  })();
  const img = live.prepare("SELECT file, thumb FROM source_images WHERE object_id = ?").get(m.id) as any;
  for (const f of [img?.file, img?.thumb].filter(Boolean)) {
    const from = join(opts.spareImages, f);
    if (existsSync(from)) { copyFileSync(from, join(opts.liveImages, f)); images++; }
  }
  for (const p of live.prepare("SELECT stem FROM property_images WHERE object_id = ?").all(m.id) as any[]) {
    for (const f of [`${p.stem}.jpg`, `${p.stem}.thumb.jpg`]) {
      const from = join(opts.spareImages, f);
      if (existsSync(from)) { copyFileSync(from, join(opts.liveImages, f)); images++; }
    }
  }
  const por = live.prepare("SELECT stem FROM person_portraits WHERE object_id = ?").get(m.id) as any;
  for (const f of por ? [`${por.stem}.jpg`, `${por.stem}.thumb.jpg`] : []) {
    const from = join(opts.spareImages, f);
    if (existsSync(from)) { copyFileSync(from, join(opts.liveImages, f)); images++; }
  }
  return { status: "brought-back", id: m.id, title: m.title, tag, tables, images, connectionsSkipped };
}
