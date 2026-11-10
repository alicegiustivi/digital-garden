// The Archivist (CONTEXT.md: Archivist). For a newly captured Object it names the format, fills in facts about a Source
// (title, authors, date) and adds Tags. All of it is an AI Contribution applied directly: marked ✦ with the role, model and
// date (ADR 0001), and undone in one click. It never touches the owner's words, never overwrites anything the owner wrote,
// and never creates a new Object or changes an Object Type: those are Suggestions (suggestions.ts). Since issue #66 it also
// adds Connections of kind "related" and "authored by" directly (ADR 0003): marked ✦, undone in one click, remembered if undone.
import type Database from "better-sqlite3";
import { cleanTagName, tagIdFor } from "./objects.ts";
import { broadTags, VAGUE_TAGS } from "./ai-prompt.ts";
import { ENTITY_FIELDS } from "./describe.ts";

type Db = Database.Database;
export const ROLE = "Archivist";
const FORMATS = ["book", "article", "video", "podcast", "web page", "image", "document"];

export type Findings = { format?: string; title?: string; authors?: string; published?: string; tags: string[]; /** For a Person or Concept: the fields written from the Garden's Sources (describe.ts). */ facts?: Record<string, string> };

/** Reads the model's answer. Anything that isn't a clear JSON object is "unusable" (null), never guessed at. */
export function jsonOf(text: string): any | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let j: any;
  try { j = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  return j && typeof j === "object" && !Array.isArray(j) ? j : null;
}

export function parseFindings(text: string): Findings | null {
  const j = jsonOf(text);
  if (!j) return null;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : undefined);
  const format = typeof j.format === "string" && FORMATS.includes(j.format.trim().toLowerCase()) ? j.format.trim().toLowerCase() : undefined;
  const published = str(j.published, 10);
  const tags = Array.isArray(j.tags) ? [...new Set((j.tags as unknown[]).map(cleanTagName).filter((t) => t && t.length <= 40 && !VAGUE_TAGS.has(t)))].slice(0, 4) : [];
  return {
    format,
    title: str(j.title, 200),
    authors: str(j.authors, 200),
    published: published && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(published) ? published : undefined,
    tags,
  };
}

type Change =
  | { kind: "field"; field: string; before: null | { value: string; origin: string; aiRole: string | null; aiModel: string | null; aiDate: string | null } }
  | { kind: "tag"; tagId: number; name: string }
  | { kind: "connection"; connectionId: number; otherId: string; connKind: string };

/** Applies findings in one go (all or nothing) and records what changed. Returns the run id, or null if nothing changed. */
export function applyFindings(db: Db, id: string, f: Findings, model: string, now: Date): number | null {
  const obj = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  if (!obj) return null; // gone, or made Private while the AI was thinking: nothing is written
  const date = now.toISOString().slice(0, 10);
  const changes: Change[] = [];
  const get = db.prepare("SELECT value, origin, ai_role, ai_model, ai_date FROM field_values WHERE object_id = ? AND field = ?");
  // The owner's value is never touched. An earlier AI value is only replaced when asked to (a description grows with the Garden).
  const put = (field: string, value: string, how: { replaceSource?: boolean; replaceAi?: boolean } = {}) => {
    const cur = get.get(id, field) as any;
    if (cur?.origin === "owner") return;
    if (cur?.origin === "ai" && !(how.replaceAi && cur.value !== value)) return;
    if (cur?.origin === "source" && !(how.replaceSource && cur.value !== value)) return;
    db.prepare(
      `INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date) VALUES (?, ?, ?, 'ai', ?, ?, ?)
       ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'ai', ai_role = excluded.ai_role, ai_model = excluded.ai_model, ai_date = excluded.ai_date`,
    ).run(id, field, value, ROLE, model, date);
    if (field === "title") db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(value, id);
    changes.push({ kind: "field", field, before: cur ? { value: cur.value, origin: cur.origin, aiRole: cur.ai_role, aiModel: cur.ai_model, aiDate: cur.ai_date } : null });
  };

  db.transaction(() => {
    if (obj.type === "source") { // facts about a Source; a Thought is the owner's and only ever gets Tags
      if (f.format) put("format", f.format, { replaceSource: true });
      if (f.title) put("title", f.title);
      if (f.authors) put("authors", f.authors);
      if (f.published) put("published", f.published);
    }
    for (const [k, v] of Object.entries(f.facts ?? {})) if (ENTITY_FIELDS[obj.type]?.includes(k)) put(k, v, { replaceAi: true }); // a Person's or Concept's description, from the Sources
    const rejected = new Set((db.prepare("SELECT value FROM ai_rejected WHERE object_id = ? AND kind = 'tag'").all(id) as any[]).map((r) => r.value));
    const broad = broadTags(db); // a Tag already on a quarter of the Garden says too little to add again
    for (const name of f.tags) {
      if (rejected.has(name) || broad.has(name)) continue;
      const tagId = tagIdFor(db, name);
      const added = db
        .prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) VALUES (?, ?, 'ai', ?, ?, ?)")
        .run(id, tagId, ROLE, model, date);
      if (added.changes) changes.push({ kind: "tag", tagId, name });
    }
    if (changes.length) db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();
  if (!changes.length) return null;
  return Number(db.prepare("INSERT INTO ai_runs (object_id, model, created_at, changes) VALUES (?, ?, ?, ?)").run(id, model, now.toISOString(), JSON.stringify(changes)).lastInsertRowid);
}

const pairExists = (db: Db, a: string, b: string) => db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(a, b, b, a);
const usable = (db: Db, id: string) => !!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id);

/**
 * Adds one Connection the Archivist found, applied at once with AI Origin (not yet approved, so it shows ✦). Skips a pair that is
 * already connected, one the owner undid before, and anything Private or in the Bin. Returns the new Connection's id, or null.
 */
export function addDirectConnection(db: Db, id: string, otherId: string, kind: "related" | "authored by", model: string, date: string): number | null {
  if (id === otherId || !usable(db, id) || !usable(db, otherId) || pairExists(db, id, otherId)) return null;
  if (db.prepare("SELECT 1 FROM ai_rejected WHERE object_id = ? AND kind = 'connection' AND value = ?").get(id, otherId)) return null;
  return Number(db.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date, approved) VALUES (?, ?, ?, 'ai', ?, ?, ?, 0)").run(id, otherId, kind, ROLE, model, date).lastInsertRowid);
}

/** Adds changes to this run (or starts a run when the facts and Tags changed nothing), so one Undo covers it all. */
export function recordInRun(db: Db, id: string, model: string, now: Date, runId: number | null, added: Change[]) {
  const run = runId ? (db.prepare("SELECT * FROM ai_runs WHERE id = ? AND undone_at IS NULL").get(runId) as any) : null;
  if (run) {
    db.prepare("UPDATE ai_runs SET changes = ? WHERE id = ?").run(JSON.stringify([...(JSON.parse(run.changes) as Change[]), ...added]), run.id);
  } else {
    db.prepare("INSERT INTO ai_runs (object_id, model, created_at, changes) VALUES (?, ?, ?, ?)").run(id, model, now.toISOString(), JSON.stringify(added));
  }
  db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
}

/** Undo one Archivist Connection: it is removed and remembered from both ends, so it is not proposed again unless the owner asks. */
function takeBack(db: Db, c: { id: number; from_id: string; to_id: string }) {
  db.prepare("DELETE FROM connections WHERE id = ?").run(c.id);
  const remember = db.prepare("INSERT OR IGNORE INTO ai_rejected (object_id, kind, value) VALUES (?, 'connection', ?)");
  remember.run(c.from_id, c.to_id);
  remember.run(c.to_id, c.from_id);
}

/** One click on one Connection. Only a Connection still the Archivist's (not approved, not the owner's) can be taken back this way. */
export function undoConnection(db: Db, connectionId: number): { objectIds: string[] } | null {
  const c = db.prepare("SELECT * FROM connections WHERE id = ? AND origin = 'ai' AND approved = 0 AND ai_role = ?").get(connectionId, ROLE) as any;
  if (!c) return null;
  db.transaction(() => {
    takeBack(db, c);
    db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id IN (?, ?)").run(c.from_id, c.to_id);
  })();
  return { objectIds: [c.from_id, c.to_id] };
}

const stillThere = (db: Db, c: { connectionId: number; otherId: string }) =>
  !!db.prepare("SELECT 1 FROM connections WHERE id = ? AND origin = 'ai' AND approved = 0 AND (from_id = ? OR to_id = ?)").get(c.connectionId, c.otherId, c.otherId);

/** The latest Archivist run on this Object that has not been undone, described for the page. */
export function lastRun(db: Db, id: string) {
  const r = db.prepare("SELECT * FROM ai_runs WHERE object_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1").get(id) as any;
  if (!r) return null;
  const changes = JSON.parse(r.changes) as Change[];
  return {
    id: r.id as number,
    model: r.model as string,
    at: r.created_at as string,
    facts: changes.filter((c) => c.kind === "field").map((c: any) => c.field as string),
    tags: changes.filter((c) => c.kind === "tag").map((c: any) => c.name as string),
    connections: changes.filter((c: any) => c.kind === "connection" && stillThere(db, c)).length,
  };
}

/** One click: take back everything the run changed. A value the owner has edited since is left as theirs. A Tag undone is remembered as turned down. */
export function undoRun(db: Db, id: string) {
  const r = db.prepare("SELECT * FROM ai_runs WHERE object_id = ? AND undone_at IS NULL ORDER BY id DESC LIMIT 1").get(id) as any;
  if (!r) return false;
  const changes = JSON.parse(r.changes) as Change[];
  db.transaction(() => {
    for (const c of changes) {
      if (c.kind === "connection") {
        // Only while it is still the Archivist's own: an approved one or one the owner changed the kind of has become theirs to keep.
        const cur = db.prepare("SELECT * FROM connections WHERE id = ? AND origin = 'ai' AND approved = 0 AND ai_role = ?").get(c.connectionId, ROLE) as any;
        if (cur && (cur.from_id === c.otherId || cur.to_id === c.otherId)) takeBack(db, cur);
      } else if (c.kind === "tag") {
        const cur = db.prepare("SELECT origin FROM object_tags WHERE object_id = ? AND tag_id = ?").get(id, c.tagId) as any;
        if (cur?.origin !== "ai") continue; // the owner has since made it their own
        db.prepare("DELETE FROM object_tags WHERE object_id = ? AND tag_id = ?").run(id, c.tagId);
        db.prepare("INSERT OR IGNORE INTO ai_rejected (object_id, kind, value) VALUES (?, 'tag', ?)").run(id, c.name);
      } else {
        const cur = db.prepare("SELECT origin FROM field_values WHERE object_id = ? AND field = ?").get(id, c.field) as any;
        if (cur?.origin !== "ai") continue;
        if (c.before) {
          db.prepare("UPDATE field_values SET value = ?, origin = ?, ai_role = ?, ai_model = ?, ai_date = ? WHERE object_id = ? AND field = ?")
            .run(c.before.value, c.before.origin, c.before.aiRole, c.before.aiModel, c.before.aiDate, id, c.field);
        } else db.prepare("DELETE FROM field_values WHERE object_id = ? AND field = ?").run(id, c.field);
        if (c.field === "title") db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(c.before?.value ?? null, id);
      }
    }
    db.prepare("UPDATE ai_runs SET undone_at = ? WHERE id = ?").run(new Date().toISOString(), r.id);
    db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();
  return true;
}
