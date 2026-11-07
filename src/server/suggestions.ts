// Suggestions and AI Notes (issue #32; CONTEXT.md: Suggestion, Approve, AI Note; ADR 0001).
// The Archivist's single call may come back with more than facts and Tags. What touches structure waits here as a
// Suggestion until the owner approves or rejects it; AI-written text is kept as an AI Note beside the body.
//  - Approving keeps AI Origin for good (shown ✧). Only editing a short value afterwards makes it the owner's.
//  - Rejecting is remembered (ai_rejected) and never proposed again unless the owner asks.
//  - A Suggestion never touches a Thought, except a suggested title.
//  - Nothing here is ever written for a Private Object, or about one.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { BadRequest, titleOf } from "./objects.ts";
import { readable, type Candidate } from "./ai-prompt.ts";
import { renderRefs, sourceOfNote } from "./researcher.ts";

type Db = Database.Database;
export const ROLE = "Archivist";
export const MAX_CONNECTIONS = 5;
const MAX_NEW_OBJECTS = 3;

/** What the model said beyond the facts and Tags. Anything unclear is left out, never guessed at. */
export type Proposals = { summary?: string; related: string[]; people: { name: string; central: boolean }[]; type?: string; thoughtTitle?: string };

export function parseProposals(j: any): Proposals {
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : undefined);
  const summary = typeof j?.summary === "string" ? j.summary.replace(/\s+/g, " ").trim() : "";
  return {
    summary: summary && summary.length <= 1200 ? summary : undefined,
    related: Array.isArray(j?.related) ? [...new Set((j.related as unknown[]).filter((r): r is string => typeof r === "string").map((r) => r.trim()))].slice(0, MAX_CONNECTIONS) : [],
    people: Array.isArray(j?.people)
      ? (j.people as any[]).flatMap((p) => (str(p?.name, 80) ? [{ name: str(p.name, 80)!, central: p.central === true }] : [])).slice(0, 6)
      : [],
    type: typeof j?.type === "string" ? j.type.trim().toLowerCase() : undefined,
    thoughtTitle: str(j?.thoughtTitle, 120),
  };
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const sameName = (a: string, b: string) => norm(a) === norm(b);

/** Is this name on another Source's authors? (A Person is only proposed when central, or named on two Sources.) */
function namedOnAnotherSource(db: Db, id: string, name: string): boolean {
  const rows = db
    .prepare(
      `SELECT f.value FROM field_values f JOIN objects o ON o.id = f.object_id
       WHERE f.field = 'authors' AND o.type = 'source' AND o.private = 0 AND o.deleted_at IS NULL AND o.id <> ?`,
    )
    .all(id) as any[];
  return rows.some((r) => String(r.value).split(/,|&|\band\b|;/i).some((part) => sameName(part, name)));
}

type Stored = { kind: "connection" | "type" | "object" | "title"; data: Record<string, unknown> };

/**
 * Turns what the model proposed into pending Suggestions and an AI Note, in one go. Replaces whatever was still pending
 * on this Object (so "Ask again" gives a fresh list). Returns how many Suggestions are now waiting.
 */
export function applyProposals(db: Db, id: string, p: Proposals, candidates: Candidate[], model: string, now: Date): number {
  const obj = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  if (!obj) return 0; // gone, or made Private while the AI was thinking: nothing is written
  const date = now.toISOString().slice(0, 10);
  const isThought = obj.type === "thought";
  const turnedDown = (kind: string, value: string) => !!db.prepare("SELECT 1 FROM ai_rejected WHERE object_id = ? AND kind = ? AND value = ?").get(id, kind, value);
  const list: Stored[] = [];

  if (isThought) {
    // A Thought is the owner's. The one thing offered is a title, and only while it has none.
    const hasTitle = db.prepare("SELECT 1 FROM field_values WHERE object_id = ? AND field = 'title'").get(id);
    if (p.thoughtTitle && !hasTitle && !turnedDown("title", norm(p.thoughtTitle))) list.push({ kind: "title", data: { title: p.thoughtTitle } });
  } else {
    // Connections: only to the Objects it was shown (never Private ones), "related", or "authored by" for a Person on a Source.
    const shown = new Map(candidates.map((c) => [c.ref, c]));
    const taken = new Set<string>();
    const connect = (otherId: string, kind: "related" | "authored by") => {
      if (taken.has(otherId) || taken.size >= MAX_CONNECTIONS) return;
      if (!readable(db, otherId) || turnedDown("connection", otherId)) return;
      if (db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, otherId, otherId, id)) return;
      taken.add(otherId);
      list.push({ kind: "connection", data: { otherId, kind } });
    };
    const people = candidates.filter((c) => c.type === "person");
    for (const person of p.people) {
      const known = people.find((c) => sameName(c.title, person.name));
      if (known) connect(known.id, obj.type === "source" ? "authored by" : "related");
      else if (obj.type === "source" && (person.central || namedOnAnotherSource(db, id, person.name)) && !turnedDown("object", `person:${norm(person.name)}`)) {
        if (list.filter((s) => s.kind === "object").length < MAX_NEW_OBJECTS) list.push({ kind: "object", data: { type: "person", name: person.name } });
      }
    }
    for (const ref of p.related) {
      const c = shown.get(ref);
      if (c) connect(c.id, "related");
    }
    // A change of Object Type, only between Source and Person (a Concept is made on purpose; a Thought is never changed).
    if (p.type && p.type !== obj.type && ["source", "person"].includes(p.type) && ["source", "person"].includes(obj.type) && !turnedDown("type", p.type))
      list.push({ kind: "type", data: { type: p.type } });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM ai_suggestions WHERE object_id = ? AND ai_role = ?").run(id, ROLE); // (the Researcher's are not the Archivist's to replace)
    const ins = db.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const s of list) ins.run(id, s.kind, JSON.stringify(s.data), ROLE, model, date, now.toISOString());
    // An AI Note: a short summary of a Source. A fresh one replaces the Archivist's earlier summary on this Object.
    if (obj.type === "source" && p.summary) {
      db.prepare("DELETE FROM ai_notes WHERE object_id = ? AND kind = 'summary'").run(id);
      db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at) VALUES (?, 'summary', ?, ?, ?, ?, ?)").run(id, p.summary, ROLE, model, date, now.toISOString());
    }
  })();
  return list.length;
}

// ---------- Reading them ----------

const originOf = (r: any) => ({ origin: "ai" as const, aiRole: r.ai_role as string, aiModel: r.ai_model as string, aiDate: r.ai_date as string, approved: false });
const liveObj = (db: Db, id: string) => db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any | undefined;

const TYPE_LABEL = (db: Db, key: string) => (db.prepare("SELECT label FROM object_types WHERE key = ?").get(key) as any)?.label ?? key;

/** The Suggestions waiting on one Object, worded for the page. Empty for a Private Object. */
export function suggestionsOf(db: Db, id: string) {
  const o = liveObj(db, id);
  if (!o) return null;
  const rejected = (db.prepare("SELECT count(*) AS n FROM ai_rejected WHERE object_id = ? AND kind <> 'tag'").get(id) as any).n as number;
  if (o.private) return { pending: [], rejected: 0 };
  const rows = db.prepare("SELECT * FROM ai_suggestions WHERE object_id = ? ORDER BY id").all(id) as any[];
  const pending = rows.flatMap((r): any[] => {
    const d = JSON.parse(r.data);
    const base = { id: r.id as number, kind: r.kind as string, ...originOf(r) };
    if (r.kind === "connection") {
      const other = liveObj(db, d.otherId);
      if (!other || other.private) return []; // gone or Private: never shown
      return [{ ...base, other: { id: d.otherId as string, type: other.type as string, title: titleOf(db, d.otherId) }, connectionKind: d.kind as string }];
    }
    if (r.kind === "type") return [{ ...base, type: d.type as string, typeLabel: TYPE_LABEL(db, d.type) }];
    if (r.kind === "object") return [{ ...base, type: d.type as string, typeLabel: TYPE_LABEL(db, d.type), name: d.name as string }];
    return [{ ...base, title: d.title as string }];
  });
  return { pending, rejected };
}

export const pendingCount = (db: Db, id: string) => (suggestionsOf(db, id)?.pending.length ?? 0);

// ---------- Approve / Reject ----------

const aiCols = (r: any) => [r.ai_role, r.ai_model, r.ai_date] as const;
const touch = (db: Db, id: string) => db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);

/** Approve: it takes effect and keeps AI Origin (marked ✧). Returns the Object the owner was looking at. */
export function approve(db: Db, suggestionId: number) {
  const s = db.prepare("SELECT * FROM ai_suggestions WHERE id = ?").get(suggestionId) as any;
  if (!s) return null;
  const o = liveObj(db, s.object_id);
  if (!o || o.private) { db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(s.id); throw new BadRequest("That one is no longer available"); }
  const d = JSON.parse(s.data);
  const pairExists = (a: string, b: string) => db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(a, b, b, a);
  const link = (from: string, to: string, kind: string) =>
    db.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date, approved) VALUES (?, ?, ?, 'ai', ?, ?, ?, 1)").run(from, to, kind, ...aiCols(s));
  db.transaction(() => {
    if (s.kind === "connection") {
      const other = liveObj(db, d.otherId);
      if (!other || other.private) throw new BadRequest("That Object is no longer available");
      if (pairExists(s.object_id, d.otherId)) throw new BadRequest("These two are already connected");
      link(s.object_id, d.otherId, d.kind); // "authored by" reads from the Source to the Person
    } else if (s.kind === "type") {
      db.prepare("UPDATE objects SET type = ?, type_ai = ? WHERE id = ?").run(d.type, JSON.stringify({ aiRole: s.ai_role, aiModel: s.ai_model, aiDate: s.ai_date }), s.object_id);
    } else if (s.kind === "object") {
      // A Person already in the Garden under that name is used rather than made twice.
      const existing = (db.prepare("SELECT id FROM objects WHERE type = ? AND deleted_at IS NULL").all(d.type) as any[]).find((r) => sameName(titleOf(db, r.id), d.name));
      let pid = existing?.id as string | undefined;
      if (!pid) {
        pid = randomUUID();
        db.prepare("INSERT INTO objects (id, type, updated_at) VALUES (?, ?, datetime('now'))").run(pid, d.type);
        db.prepare("INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date, approved) VALUES (?, 'title', ?, 'ai', ?, ?, ?, 1)").run(pid, d.name, ...aiCols(s));
        db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(d.name, pid);
      }
      if (!pairExists(s.object_id, pid)) link(s.object_id, pid, o.type === "source" ? "authored by" : "related");
    } else if (s.kind === "title") {
      db.prepare(
        `INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date, approved) VALUES (?, 'title', ?, 'ai', ?, ?, ?, 1)
         ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'ai', ai_role = excluded.ai_role, ai_model = excluded.ai_model, ai_date = excluded.ai_date, approved = 1`,
      ).run(s.object_id, d.title, ...aiCols(s));
      db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(d.title, s.object_id);
    }
    db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(s.id);
    touch(db, s.object_id);
  })();
  return s.object_id as string;
}

/** What is remembered so the same thing is not proposed again. */
function rememberable(s: any): { kind: string; value: string } {
  const d = JSON.parse(s.data);
  return s.kind === "connection" ? { kind: "connection", value: d.otherId }
    : s.kind === "type" ? { kind: "type", value: d.type }
    : s.kind === "object" ? { kind: "object", value: `${d.type}:${norm(d.name)}` }
    : { kind: "title", value: norm(d.title) };
}

export function reject(db: Db, suggestionId: number) {
  const s = db.prepare("SELECT * FROM ai_suggestions WHERE id = ?").get(suggestionId) as any;
  if (!s) return null;
  const r = rememberable(s);
  db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO ai_rejected (object_id, kind, value) VALUES (?, ?, ?)").run(s.object_id, r.kind, r.value);
    db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(s.id);
  })();
  return s.object_id as string;
}

/** The owner asks for turned-down Suggestions to be allowed again. (Removed AI Tags are included.) */
export function forgetRejected(db: Db, objectId: string) {
  return db.prepare("DELETE FROM ai_rejected WHERE object_id = ?").run(objectId).changes;
}

// ---------- AI Notes ----------

export function notesOf(db: Db, id: string) {
  const o = liveObj(db, id);
  if (!o) return null;
  if (o.private) return []; // a Private Object's AI Notes were deleted when it became Private
  return (db.prepare("SELECT * FROM ai_notes WHERE object_id = ? ORDER BY id").all(id) as any[]).map((n) => {
    const { text, links } = renderRefs(db, n.text); // links to Objects that are gone are dropped
    return { id: n.id as number, kind: n.kind as string, text, links, from: sourceOfNote(db, n), ...originOf(n) };
  });
}

/** Delete an AI Note. Returns it so the page can offer Undo. */
export function deleteNote(db: Db, noteId: number) {
  const n = db.prepare("SELECT * FROM ai_notes WHERE id = ?").get(noteId) as any;
  if (!n) return null;
  db.prepare("DELETE FROM ai_notes WHERE id = ?").run(noteId);
  return { objectId: n.object_id as string, kind: n.kind as string, text: n.text as string, aiRole: n.ai_role as string, aiModel: n.ai_model as string, aiDate: n.ai_date as string, inquiryId: (n.inquiry_id ?? null) as string | null, question: (n.question ?? null) as string | null };
}
export function restoreNote(db: Db, n: any) {
  if (!n || typeof n.objectId !== "string" || typeof n.text !== "string" || !n.aiRole || !n.aiModel || !n.aiDate) throw new BadRequest("a note to put back is needed");
  const o = liveObj(db, n.objectId);
  if (!o || o.private) throw new BadRequest("That Object could not be found");
  db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at, inquiry_id, question) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(n.objectId, ["prompt", "answer"].includes(n.kind) ? n.kind : "summary", n.text, n.aiRole, n.aiModel, n.aiDate, new Date().toISOString(), n.inquiryId ?? null, n.question ?? null);
  return { restored: true };
}

/**
 * "Start a Thought from this": a new, empty Thought for the owner's own words, the AI Note attached beside it as its
 * prompt (still AI), and an "inspired by" Connection to the Object the note sits on. A Thought the owner starts on
 * purpose is never Unreviewed.
 */
export function startThoughtFromNote(db: Db, noteId: number) {
  const n = db.prepare("SELECT * FROM ai_notes WHERE id = ?").get(noteId) as any;
  if (!n) return null;
  const src = liveObj(db, n.object_id);
  if (!src || src.private) return null;
  const id = randomUUID();
  db.transaction(() => {
    db.prepare("INSERT INTO objects (id, type, updated_at) VALUES (?, 'thought', datetime('now'))").run(id);
    db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at, inquiry_id, question) VALUES (?, 'prompt', ?, ?, ?, ?, ?, ?, ?)").run(id, n.text, n.ai_role, n.ai_model, n.ai_date, new Date().toISOString(), n.inquiry_id ?? null, n.question ?? null);
    db.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'inspired by', 'owner')").run(id, n.object_id);
  })();
  return id;
}
