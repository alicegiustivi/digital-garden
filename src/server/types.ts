// Making and shaping Object Types (issue #107, ADR 0008). Everything here is the OWNER's act: it is reached only from the
// Types page through the routes in app.ts, and no AI role imports this file (tests/types.test.ts checks that).
// The four Core types can be recoloured and reordered, nothing else. A type the owner makes is a plain Object type.
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { BadRequest } from "./objects.ts";
import { isColour, isTypeIcon } from "../shared/palette.ts";

type Db = Database.Database;
const MAX_TYPES = 40;
const MAX_FIELDS = 12;
const INPUTS = ["text", "longtext", "select"] as const;

const name = (v: unknown, what: string) => {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  if (!s) throw new BadRequest(`Give the ${what} a name`);
  if (s.length > 40) throw new BadRequest(`The ${what} name is too long (40 letters at most)`);
  return s;
};
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "type";
const exists = (db: Db, key: string) => db.prepare("SELECT 1 FROM object_types WHERE key = ?").get(key);
const row = (db: Db, key: string) => {
  const t = db.prepare("SELECT * FROM object_types WHERE key = ?").get(key) as any;
  if (!t) throw new BadRequest("That type does not exist");
  return t;
};
const custom = (db: Db, key: string) => {
  const t = row(db, key);
  if (t.core) throw new BadRequest("The four core types keep their fields. You can change their colour.");
  return t;
};
const sameName = (db: Db, label: string, plural: string, except?: string) => {
  const clash = db.prepare("SELECT key FROM object_types WHERE key <> ? AND (lower(label) IN (lower(?), lower(?)) OR lower(plural) IN (lower(?), lower(?)))").get(except ?? "", label, plural, label, plural);
  if (clash) throw new BadRequest("Another type already has that name");
};

/** "Book" → "Books". The owner can write any plural; this is only the suggestion. */
export const pluralOf = (label: string) => (/(s|x|z|ch|sh)$/i.test(label) ? label + "es" : /[^aeiou]y$/i.test(label) ? label.slice(0, -1) + "ies" : label + "s");

export function createType(db: Db, input: { label?: unknown; plural?: unknown; color?: unknown; icon?: unknown }) {
  const label = name(input.label, "type");
  const plural = input.plural === undefined || input.plural === "" ? pluralOf(label) : name(input.plural, "type");
  if (!isColour(input.color)) throw new BadRequest("Choose one of the colours");
  if (!isTypeIcon(input.icon)) throw new BadRequest("Choose one of the icons");
  if ((db.prepare("SELECT count(*) AS n FROM object_types").get() as any).n >= MAX_TYPES) throw new BadRequest("That is a lot of types. Remove one you no longer use first.");
  sameName(db, label, plural);
  let key = `x-${slug(label)}`, n = 2;
  while (exists(db, key)) key = `x-${slug(label)}-${n++}`; // the key never changes after this, even if the type is renamed
  const position = (db.prepare("SELECT coalesce(max(position), 0) + 1 AS p FROM object_types").get() as any).p;
  db.prepare("INSERT INTO object_types (key, label, plural, position, color, icon, core) VALUES (?, ?, ?, ?, ?, ?, 0)").run(key, label, plural, position, input.color, input.icon);
  return key;
}

/** Rename, recolour or change the icon. Always allowed, for Core types too (colour only there). The key stays. */
export function updateType(db: Db, key: string, patch: { label?: unknown; plural?: unknown; color?: unknown; icon?: unknown }) {
  const t = row(db, key);
  if (t.core && (patch.label !== undefined || patch.plural !== undefined || patch.icon !== undefined)) throw new BadRequest("A core type keeps its name and icon. You can change its colour.");
  const label = patch.label === undefined ? t.label : name(patch.label, "type");
  const plural = patch.plural === undefined ? t.plural : name(patch.plural, "type");
  if (patch.color !== undefined && !isColour(patch.color)) throw new BadRequest("Choose one of the colours");
  if (patch.icon !== undefined && !isTypeIcon(patch.icon)) throw new BadRequest("Choose one of the icons");
  sameName(db, label, plural, key);
  db.prepare("UPDATE object_types SET label = ?, plural = ?, color = ?, icon = ? WHERE key = ?").run(label, plural, patch.color ?? t.color, patch.icon ?? t.icon, key);
}

export function reorderTypes(db: Db, keys: unknown) {
  const all = (db.prepare("SELECT key FROM object_types").all() as any[]).map((r) => r.key as string);
  if (!Array.isArray(keys) || keys.length !== all.length || new Set(keys).size !== all.length || keys.some((k) => !all.includes(k))) throw new BadRequest("The order must list every type once");
  const set = db.prepare("UPDATE object_types SET position = ? WHERE key = ?");
  db.transaction(() => keys.forEach((k, i) => set.run(i + 1, k)))();
}

/** How many Objects are in a type, and how many of those are in the Bin (they come back from the Bin as that type, so they count). */
export const usage = (db: Db, key: string) => {
  const r = db.prepare("SELECT count(*) AS total, coalesce(sum(deleted_at IS NOT NULL), 0) AS bin FROM objects WHERE type = ?").get(key) as any;
  return { total: r.total as number, bin: r.bin as number };
};

/** The owner moves every Object of one type to another (the way to empty a type before it can be removed). Returns how many moved. */
export function moveObjects(db: Db, from: string, to: unknown) {
  row(db, from);
  if (typeof to !== "string" || !exists(db, to)) throw new BadRequest("Choose the type to move them to");
  if (to === from) throw new BadRequest("Choose a different type");
  // Choosing a type is the owner's decision, so it stops being the Archivist's (as when one Object is retyped).
  return db.prepare("UPDATE objects SET type = ?, type_ai = NULL WHERE type = ?").run(to, from).changes;
}

/** A type with Objects, the Bin included, cannot be removed: move them first. Core types cannot be removed. */
export function deleteType(db: Db, key: string) {
  const t = custom(db, key);
  const u = usage(db, key);
  if (u.total) throw new BadRequest(`${t.plural} still has ${u.total} ${u.total === 1 ? "Object" : "Objects"}${u.bin ? ` (${u.bin} in the Bin)` : ""}. Move them to another type first.`);
  db.transaction(() => {
    for (const f of fieldKeys(db, key)) dropField(db, key, f);
    db.prepare("DELETE FROM object_types WHERE key = ?").run(key);
  })();
}

// --- The type's own properties: short text, long text or a choice from a list ---

const fieldKeys = (db: Db, type: string) => (db.prepare("SELECT field FROM type_fields WHERE type = ?").all(type) as any[]).map((r) => r.field as string);
const optionsOf = (input: unknown, options: unknown) => {
  if (input !== "select") return null;
  const list = Array.isArray(options) ? [...new Set(options.map((o) => (typeof o === "string" ? o.trim() : "")).filter(Boolean))] : [];
  if (list.length < 2) throw new BadRequest("A choice needs at least two options");
  if (list.length > 20 || list.some((o) => o.length > 40)) throw new BadRequest("Keep a choice to 20 options of 40 letters or fewer");
  return JSON.stringify(list);
};

export function addField(db: Db, type: string, input: { label?: unknown; input?: unknown; options?: unknown; lead?: unknown }) {
  custom(db, type);
  const label = name(input.label, "property");
  if (!INPUTS.includes(input.input as any)) throw new BadRequest("A property is short text, long text or a choice");
  if (fieldKeys(db, type).length >= MAX_FIELDS) throw new BadRequest(`A type can have ${MAX_FIELDS} properties at most`);
  const taken = db.prepare("SELECT 1 FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? AND lower(fd.label) = lower(?)").get(type, label);
  if (taken) throw new BadRequest("This type already has a property with that name");
  const options = optionsOf(input.input, input.options);
  const key = `c-${randomBytes(5).toString("hex")}`; // properties are keyed by their own id, so renaming never loses a value
  const position = (db.prepare("SELECT coalesce(max(position), -1) + 1 AS p FROM type_fields WHERE type = ?").get(type) as any).p;
  db.transaction(() => {
    db.prepare("INSERT INTO field_definitions (key, label, input, options) VALUES (?, ?, ?, ?)").run(key, label, input.input, options);
    db.prepare("INSERT INTO type_fields (type, field, position, lead) VALUES (?, ?, ?, 0)").run(type, key, position);
    if (input.lead) setLead(db, type, key);
  })();
  return key;
}

function setLead(db: Db, type: string, field: string) {
  db.prepare("UPDATE type_fields SET lead = (field = ?) WHERE type = ?").run(field, type); // only one is shown under the title
}

export function updateField(db: Db, type: string, field: string, patch: { label?: unknown; options?: unknown; lead?: unknown }) {
  custom(db, type);
  const f = db.prepare("SELECT fd.* FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? AND tf.field = ?").get(type, field) as any;
  if (!f) throw new BadRequest("That property does not exist");
  db.transaction(() => {
    if (patch.label !== undefined) {
      const label = name(patch.label, "property");
      const taken = db.prepare("SELECT 1 FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? AND tf.field <> ? AND lower(fd.label) = lower(?)").get(type, field, label);
      if (taken) throw new BadRequest("This type already has a property with that name");
      db.prepare("UPDATE field_definitions SET label = ? WHERE key = ?").run(label, field);
    }
    if (patch.options !== undefined) {
      if (f.input !== "select") throw new BadRequest("Only a choice has options");
      db.prepare("UPDATE field_definitions SET options = ? WHERE key = ?").run(optionsOf("select", patch.options), field);
    }
    if (patch.lead === true) setLead(db, type, field);
    if (patch.lead === false) db.prepare("UPDATE type_fields SET lead = 0 WHERE type = ? AND field = ?").run(type, field);
  })();
}

export function reorderFields(db: Db, type: string, keys: unknown) {
  custom(db, type);
  const all = fieldKeys(db, type);
  if (!Array.isArray(keys) || keys.length !== all.length || new Set(keys).size !== all.length || keys.some((k) => !all.includes(k))) throw new BadRequest("The order must list every property once");
  const set = db.prepare("UPDATE type_fields SET position = ? WHERE type = ? AND field = ?");
  db.transaction(() => keys.forEach((k, i) => set.run(i, type, k)))();
}

/** What removing a property would take with it, so the page can say so before anything is lost. */
export function fieldRemoval(db: Db, type: string, field: string) {
  custom(db, type);
  const r = db.prepare("SELECT count(*) AS values_, coalesce(sum(o.deleted_at IS NOT NULL), 0) AS bin FROM field_values v JOIN objects o ON o.id = v.object_id WHERE v.field = ?").get(field) as any;
  return { values: r.values_ as number, inBin: r.bin as number };
}

function dropField(db: Db, type: string, field: string) {
  db.prepare("DELETE FROM field_values WHERE field = ?").run(field);
  db.prepare("DELETE FROM type_fields WHERE type = ? AND field = ?").run(type, field);
  db.prepare("DELETE FROM field_definitions WHERE key = ?").run(field);
}

/** Removes a property and the values owners and the Archivist put in it. The page has shown the count and asked first. */
export function removeField(db: Db, type: string, field: string) {
  const gone = fieldRemoval(db, type, field);
  if (!db.prepare("SELECT 1 FROM type_fields WHERE type = ? AND field = ?").get(type, field)) throw new BadRequest("That property does not exist");
  db.transaction(() => dropField(db, type, field))();
  return gone;
}
