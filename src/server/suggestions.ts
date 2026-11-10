// Suggestions and AI Notes (issue #32; CONTEXT.md: Suggestion, Approve, AI Note; ADR 0001, 0003).
// Since issue #66 a Connection of kind related / authored by is NOT a Suggestion: it is applied at once, marked ✦ and undone in
// one click (see applyProposals). Specific kinds, a change of kind and Researcher Connections still wait for approval.
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
import { AI_CONFIG } from "./ai-config.ts";
import { addDirectConnection, recordInRun } from "./archivist.ts";

type Db = Database.Database;
export const ROLE = "Archivist";
export const MAX_CONNECTIONS = AI_CONFIG.maxConnections; // one setting (ai-config.ts)
const MAX_NEW_OBJECTS = 3;

/** What the model said beyond the facts and Tags. Anything unclear is left out, never guessed at. */
export type Proposals = { summary?: string; claims: string[]; related: string[]; people: { name: string; central: boolean }[]; type?: string; thoughtTitle?: string };

export function parseProposals(j: any): Proposals {
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.trim().length <= max ? v.trim() : undefined);
  const summary = typeof j?.summary === "string" ? j.summary.replace(/\s+/g, " ").trim() : "";
  // The Source's main claims, each marked as something the text reports or an interpretation held by someone (the Garden's Origin rule, Schema: Reported / Interpretation).
  const claims = Array.isArray(j?.claims)
    ? (j.claims as any[]).flatMap((c) => {
        const text = str(c?.claim, 400);
        if (!text) return [];
        const by = str(c?.by, 80);
        return [c?.kind === "interpretation" ? `Interpretation${by ? ` (${by})` : ""}: ${text}` : `Reported: ${text}`];
      }).slice(0, 6)
    : [];
  return {
    summary: summary && summary.length <= 1500 ? summary : undefined,
    claims,
    related: [], // judged in the Archivist's second request, with the candidates' content (parseConnections)
    people: Array.isArray(j?.people)
      ? (j.people as any[]).flatMap((p) => (str(p?.name, 80) ? [{ name: str(p.name, 80)!, central: p.central === true }] : [])).slice(0, 6)
      : [],
    type: typeof j?.type === "string" ? j.type.trim().toLowerCase() : undefined,
    thoughtTitle: str(j?.thoughtTitle, 120),
  };
}

const SPECIFIC = ["supports", "contradicts", "builds on", "inspired by"];
export type Judged = { related: { ref: string; why?: string }[]; specific: { ref: string; kind: string; why?: string }[] };
/** The second request's answer: plain "related" Connections, and specific kinds that wait as Suggestions. Anything unclear is left out. */
export function parseConnections(j: any): Judged {
  const why = (v: unknown) => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim().slice(0, 300) : undefined);
  const ref = (v: unknown) => (typeof v === "string" ? v.trim() : typeof (v as any)?.ref === "string" ? (v as any).ref.trim() : "");
  const related = (Array.isArray(j?.related) ? (j.related as any[]) : []).flatMap((r) => (ref(r) ? [{ ref: ref(r), why: why(r?.why) }] : []));
  const specific = (Array.isArray(j?.specific) ? (j.specific as any[]) : []).flatMap((r) => {
    const kind = typeof r?.kind === "string" ? r.kind.trim().toLowerCase() : "";
    return ref(r) && SPECIFIC.includes(kind) ? [{ ref: ref(r), kind, why: why(r?.why) }] : [];
  });
  return { related: related.slice(0, MAX_CONNECTIONS), specific: specific.slice(0, 3) };
}

/**
 * The second request's result. "related" Connections are applied at once, marked and undoable (ADR 0003); a specific kind
 * (supports, contradicts, builds on, inspired by) only ever waits as a Suggestion, with the reason the model gave. Never a Thought,
 * never a Private Object, never a pair already connected or turned down.
 */
export function applyConnections(db: Db, id: string, judged: Judged, candidates: Candidate[], model: string, now: Date, runId: number | null): number {
  const obj = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  if (!obj || obj.type === "thought") return 0;
  const date = now.toISOString().slice(0, 10);
  const shown = new Map(candidates.map((c) => [c.ref, c]));
  const turnedDown = (otherId: string) => !!db.prepare("SELECT 1 FROM ai_rejected WHERE object_id = ? AND kind = 'connection' AND value = ?").get(id, otherId);
  const joined = (otherId: string) => db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, otherId, otherId, id);
  const waiting = (otherId: string) => db.prepare("SELECT 1 FROM ai_suggestions WHERE kind = 'connection' AND object_id = ? AND json_extract(data, '$.otherId') = ?").get(id, otherId);
  const taken = new Set<string>();
  const direct: string[] = [];
  const specific: { otherId: string; kind: string; why?: string }[] = [];
  for (const s of judged.specific) { // first, so a meaningful kind is not pre-empted by a plain "related"
    const c = shown.get(s.ref);
    if (!c || taken.has(c.id) || !readable(db, c.id) || turnedDown(c.id) || joined(c.id) || waiting(c.id)) continue;
    taken.add(c.id);
    specific.push({ otherId: c.id, kind: s.kind, why: s.why });
  }
  for (const r of judged.related) {
    const c = shown.get(r.ref);
    if (!c || taken.has(c.id) || taken.size >= MAX_CONNECTIONS + specific.length || !readable(db, c.id) || turnedDown(c.id) || joined(c.id)) continue;
    taken.add(c.id);
    direct.push(c.id);
  }
  db.transaction(() => {
    const ins = db.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'connection', ?, ?, ?, ?, ?)");
    for (const s of specific) ins.run(id, JSON.stringify({ otherId: s.otherId, kind: s.kind, ...(s.why ? { why: s.why } : {}) }), ROLE, model, date, now.toISOString());
    const added = direct.flatMap((otherId) => { const cid = addDirectConnection(db, id, otherId, "related", model, date); return cid ? [{ kind: "connection" as const, connectionId: cid, otherId, connKind: "related" }] : []; });
    if (added.length) recordInRun(db, id, model, now, runId, added);
  })();
  return direct.length + specific.length;
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

/** Live, non-Private Objects carrying this Tag (the Archivist may count and connect these; a Private Object is never part of it). */
const carriersOf = (db: Db, tagName: string): string[] =>
  (db.prepare(
    `SELECT o.id FROM object_tags ot JOIN tags t ON t.id = ot.tag_id JOIN objects o ON o.id = ot.object_id
     WHERE t.name = ? AND o.deleted_at IS NULL AND o.private = 0 ORDER BY o.rowid`,
  ).all(tagName) as any[]).map((r) => r.id as string);

/**
 * A Tag that keeps coming back may deserve to be a Concept (Obsidian's "Topic" threshold). Offers at most one: a Tag on this Object that
 * is on at least `conceptMinObjects` Objects, with no Concept of that name yet, not turned down on any Object, and not already offered.
 */
function conceptIdea(db: Db, id: string): { name: string; tag: string; count: number } | null {
  const mine = db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[];
  const concepts = (db.prepare("SELECT id FROM objects WHERE type = 'concept' AND deleted_at IS NULL").all() as any[]).map((r) => norm(titleOf(db, r.id)));
  let best: { name: string; tag: string; count: number } | null = null;
  for (const { name } of mine) {
    const count = carriersOf(db, name).length;
    if (count < AI_CONFIG.conceptMinObjects || concepts.includes(norm(name))) continue;
    const key = `concept:${norm(name)}`;
    if (db.prepare("SELECT 1 FROM ai_rejected WHERE kind = 'object' AND value = ?").get(key)) continue;
    if (db.prepare("SELECT 1 FROM ai_suggestions WHERE kind = 'object' AND json_extract(data, '$.type') = 'concept' AND lower(json_extract(data, '$.name')) = ? AND object_id <> ?").get(norm(name), id)) continue;
    if (!best || count > best.count) best = { name, tag: name, count };
  }
  return best;
}

type Stored = { kind: "connection" | "type" | "object" | "title"; data: Record<string, unknown> };

/**
 * Turns what the model proposed into pending Suggestions and an AI Note, in one go. Replaces whatever was still pending
 * on this Object (so "Ask again" gives a fresh list). Returns how many Suggestions are now waiting.
 */
export function applyProposals(db: Db, id: string, p: Proposals, candidates: Candidate[], model: string, now: Date, runId: number | null = null): number {
  const obj = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  if (!obj) return 0; // gone, or made Private while the AI was thinking: nothing is written
  const date = now.toISOString().slice(0, 10);
  const isThought = obj.type === "thought";
  const turnedDown = (kind: string, value: string) => !!db.prepare("SELECT 1 FROM ai_rejected WHERE object_id = ? AND kind = ? AND value = ?").get(id, kind, value);
  const list: Stored[] = [];
  const direct: { otherId: string; kind: "related" | "authored by" }[] = []; // applied at once below (issue #66)

  if (isThought) {
    // A Thought is the owner's. The one thing offered is a title, and only while it has none.
    const hasTitle = db.prepare("SELECT 1 FROM field_values WHERE object_id = ? AND field = 'title'").get(id);
    if (p.thoughtTitle && !hasTitle && !turnedDown("title", norm(p.thoughtTitle))) list.push({ kind: "title", data: { title: p.thoughtTitle } });
  } else {
    // Connections: only to the Objects it was shown (never Private ones), "related", or "authored by" for a Person on a Source.
    // These are applied directly (marked ✦, undoable); only a new Object (a Person) or a change of type waits as a Suggestion.
    const shown = new Map(candidates.map((c) => [c.ref, c]));
    const taken = new Set<string>();
    const connect = (otherId: string, kind: "related" | "authored by") => {
      if (taken.has(otherId) || taken.size >= MAX_CONNECTIONS) return;
      if (!readable(db, otherId) || turnedDown("connection", otherId)) return;
      if (db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, otherId, otherId, id)) return;
      taken.add(otherId);
      direct.push({ otherId, kind });
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
    const idea = conceptIdea(db, id);
    if (idea) list.push({ kind: "object", data: { type: "concept", name: idea.name, tag: idea.tag } });
    // A change of Object Type, only between Source and Person (a Concept is made on purpose; a Thought is never changed).
    if (p.type && p.type !== obj.type && ["source", "person"].includes(p.type) && ["source", "person"].includes(obj.type) && !turnedDown("type", p.type))
      list.push({ kind: "type", data: { type: p.type } });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM ai_suggestions WHERE object_id = ? AND ai_role = ? AND kind <> 'fact'").run(id, ROLE); // (the Researcher's are not the Archivist's to replace, nor are looked-up facts: lookup.ts)
    const ins = db.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const s of list) ins.run(id, s.kind, JSON.stringify(s.data), ROLE, model, date, now.toISOString());
    const added = direct.flatMap((d) => { const cid = addDirectConnection(db, id, d.otherId, d.kind, model, date); return cid ? [{ kind: "connection" as const, connectionId: cid, otherId: d.otherId, connKind: d.kind }] : []; });
    if (added.length) recordInRun(db, id, model, now, runId, added);
    // An AI Note: a short summary of a Source. A fresh one replaces the Archivist's earlier summary on this Object.
    if (obj.type === "source" && p.summary) {
      // The claims sit in the same note as a Markdown list, each led by its mark (Reported / Interpretation).
      const claims = p.claims.map((c) => `- ${c.replace(/^(Reported|Interpretation(?: \([^)]*\))?):/, "**$1:**")}`);
      const text = [p.summary, ...(claims.length ? ["**Key claims**", claims.join("\n")] : [])].join("\n\n");
      db.prepare("DELETE FROM ai_notes WHERE object_id = ? AND kind = 'summary'").run(id);
      db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at) VALUES (?, 'summary', ?, ?, ?, ?, ?)").run(id, text, ROLE, model, date, now.toISOString());
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
      return [{ ...base, other: { id: d.otherId as string, type: other.type as string, title: titleOf(db, d.otherId) }, connectionKind: d.kind as string, why: (d.why as string | undefined) ?? null }];
    }
    if (r.kind === "fact") {
      // A looked-up value (issue #108): Source Origin, with the link it came from. Never offered over a value the owner has written since.
      const cur = db.prepare("SELECT value, origin FROM field_values WHERE object_id = ? AND field = ?").get(id, d.field) as any;
      if (cur?.origin === "owner") return [];
      const label = (db.prepare("SELECT label FROM field_definitions WHERE key = ?").get(d.field) as any)?.label ?? d.field;
      return [{ id: r.id as number, kind: "fact", origin: "source" as const, aiRole: null, aiModel: null, aiDate: r.ai_date as string, approved: false, field: d.field as string, label: label as string, value: d.value as string, site: d.site as string, url: d.url as string, match: d.match as string, current: (cur?.value as string | undefined) ?? null }];
    }
    if (r.kind === "type") return [{ ...base, type: d.type as string, typeLabel: TYPE_LABEL(db, d.type) }];
    if (r.kind === "object") return [{ ...base, type: d.type as string, typeLabel: TYPE_LABEL(db, d.type), name: d.name as string, ...(d.type === "concept" ? { tag: d.tag as string, count: carriersOf(db, d.tag).length } : {}) }];
    return [{ ...base, title: d.title as string }];
  });
  return { pending, rejected };
}

export const pendingCount = (db: Db, id: string) => (suggestionsOf(db, id)?.pending.length ?? 0);

// ---------- Approve / Reject ----------

const aiCols = (r: any) => [r.ai_role, r.ai_model, r.ai_date] as const;
const touch = (db: Db, id: string) => db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);

/** Approve: it takes effect and keeps AI Origin (marked ✧). Returns the Object the owner was looking at. */
export function approve(db: Db, suggestionId: number, onMade?: (id: string) => void) {
  const s = db.prepare("SELECT * FROM ai_suggestions WHERE id = ?").get(suggestionId) as any;
  if (!s) return null;
  const o = liveObj(db, s.object_id);
  if (!o || o.private) { db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(s.id); throw new BadRequest("That one is no longer available"); }
  const d = JSON.parse(s.data);
  if (s.kind === "fact") { // the owner may have written this value since: theirs is never replaced
    const cur = db.prepare("SELECT origin FROM field_values WHERE object_id = ? AND field = ?").get(s.object_id, d.field) as any;
    const has = db.prepare("SELECT 1 FROM type_fields WHERE type = ? AND field = ?").get(o.type, d.field);
    if (cur?.origin === "owner" || !has) { db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(s.id); throw new BadRequest(cur?.origin === "owner" ? "You have written this yourself since, so it was left as it is" : "This type no longer has that property"); }
  }
  const pairExists = (a: string, b: string) => db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(a, b, b, a);
  let madeId: string | undefined; // a Person or Concept this approval made, so it can be described right away
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
    } else if (s.kind === "object" && d.type === "concept") {
      // A Concept from a recurring Tag: made, titled and connected as the AI's (approved), with every Object that carries the Tag. The Tag stays.
      const existing = (db.prepare("SELECT id FROM objects WHERE type = 'concept' AND deleted_at IS NULL").all() as any[]).find((r) => sameName(titleOf(db, r.id), d.name));
      let cid = existing?.id as string | undefined;
      if (!cid) {
        cid = randomUUID();
        madeId = cid;
        db.prepare("INSERT INTO objects (id, type, updated_at) VALUES (?, 'concept', datetime('now'))").run(cid);
        db.prepare("INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date, approved) VALUES (?, 'title', ?, 'ai', ?, ?, ?, 1)").run(cid, d.name, ...aiCols(s));
        db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(d.name, cid);
      }
      for (const other of [...new Set([s.object_id as string, ...carriersOf(db, d.tag ?? d.name)])]) if (other !== cid && !pairExists(cid, other)) link(cid, other, "related");
    } else if (s.kind === "object") {
      // A Person already in the Garden under that name is used rather than made twice.
      const existing = (db.prepare("SELECT id FROM objects WHERE type = ? AND deleted_at IS NULL").all(d.type) as any[]).find((r) => sameName(titleOf(db, r.id), d.name));
      let pid = existing?.id as string | undefined;
      if (!pid) {
        pid = randomUUID();
        madeId = pid;
        db.prepare("INSERT INTO objects (id, type, updated_at) VALUES (?, ?, datetime('now'))").run(pid, d.type);
        db.prepare("INSERT INTO field_values (object_id, field, value, origin, ai_role, ai_model, ai_date, approved) VALUES (?, 'title', ?, 'ai', ?, ?, ?, 1)").run(pid, d.name, ...aiCols(s));
        db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(d.name, pid);
      }
      if (!pairExists(s.object_id, pid)) link(s.object_id, pid, o.type === "source" ? "authored by" : "related");
    } else if (s.kind === "fact") {
      // Source Origin for good (it came from outside), with its link; approving changes nothing about where it came from.
      db.prepare(
        `INSERT INTO field_values (object_id, field, value, origin, source_url, source_name, source_date, approved) VALUES (?, ?, ?, 'source', ?, ?, ?, 1)
         ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'source', ai_role = NULL, ai_model = NULL, ai_date = NULL, source_url = excluded.source_url, source_name = excluded.source_name, source_date = excluded.source_date, approved = 1`,
      ).run(s.object_id, d.field, d.value, d.url, d.site, s.ai_date);
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
  if (madeId) onMade?.(madeId);
  return s.object_id as string;
}

/** What is remembered so the same thing is not proposed again. */
function rememberable(s: any): { kind: string; value: string } {
  const d = JSON.parse(s.data);
  return s.kind === "connection" ? { kind: "connection", value: d.otherId }
    : s.kind === "type" ? { kind: "type", value: d.type }
    : s.kind === "object" ? { kind: "object", value: `${d.type}:${norm(d.name)}` }
    : s.kind === "fact" ? { kind: "fact", value: `${d.field}:${norm(d.value)}` }
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

/**
 * Issue #66, once: Connections the Archivist proposed before the rule changed (related / authored by, still waiting) are applied
 * now, each marked ✦ and undoable. The owner chose this over leaving them. Safe to run on every start: nothing is left to do after.
 */
export function applyWaitingConnections(db: Db, now: Date = new Date()): number {
  const rows = db.prepare("SELECT * FROM ai_suggestions WHERE kind = 'connection' AND ai_role = ? ORDER BY id").all(ROLE) as any[];
  let applied = 0;
  db.transaction(() => {
    const byObject = new Map<string, { model: string; added: any[] }>();
    for (const r of rows) {
      const d = JSON.parse(r.data);
      if (d.kind !== "related" && d.kind !== "authored by") continue; // a specific kind keeps waiting
      const cid = addDirectConnection(db, r.object_id, d.otherId, d.kind, r.ai_model, r.ai_date);
      db.prepare("DELETE FROM ai_suggestions WHERE id = ?").run(r.id);
      if (!cid) continue;
      const g = byObject.get(r.object_id) ?? { model: r.ai_model as string, added: [] };
      g.added.push({ kind: "connection", connectionId: cid, otherId: d.otherId, connKind: d.kind });
      byObject.set(r.object_id, g);
      applied++;
    }
    for (const [id, g] of byObject) recordInRun(db, id, g.model, now, null, g.added);
  })();
  return applied;
}
