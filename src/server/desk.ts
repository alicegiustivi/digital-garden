// The Concept page as a Distill desk (issue #35): earlier versions of the owner's view, Open Questions, Tensions, grouped
// Connections, "Write a Thought about these", and the "From your Garden" strip. All of it is the owner's own view of the
// Garden, so Private Objects are included; nothing here calls an AI or leaves the Mac.
import type Database from "better-sqlite3";
import { BadRequest, createObject, titleOf } from "./objects.ts";
import { MENTION } from "./mentions.ts";
import { suggestionsOf } from "./suggestions.ts";

type Db = Database.Database;

/** The owner's local day, YYYY-MM-DD. */
export const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const asDate = (s: string | null) => (s ? new Date(s.replace(" ", "T") + "Z") : null);
const iso = (s: string | null) => (s ? s.replace(" ", "T") + "Z" : null);
const live = (db: Db, id: string) => db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any;
const brief = (db: Db, o: any) => ({ id: o.id as string, type: o.type as string, title: titleOf(db, o.id), private: !!o.private });

// ---------- Your view over time ----------

/** After the owner's view is saved: keep it as today's version (the day's last save wins), so there is at most one a day. */
export function saveVersion(db: Db, id: string, now = new Date()) {
  const o = live(db, id);
  if (!o || o.type !== "concept") return;
  const mine = (db.prepare("SELECT text FROM blocks WHERE object_id = ? AND origin = 'owner' ORDER BY position").all(id) as any[]).map((b) => b.text as string);
  if (!mine.length) db.prepare("DELETE FROM concept_versions WHERE object_id = ? AND day = ?").run(id, localDay(now));
  else
    db.prepare(
      `INSERT INTO concept_versions (object_id, day, paragraphs) VALUES (?, ?, ?)
       ON CONFLICT (object_id, day) DO UPDATE SET paragraphs = excluded.paragraphs, saved_at = datetime('now')`,
    ).run(id, localDay(now), JSON.stringify(mine));
}

/** Earlier days' versions, newest first. Mentions are shown by name so they can be read as plain text. */
function versionsOf(db: Db, id: string, now: Date) {
  const rows = db.prepare("SELECT day, paragraphs FROM concept_versions WHERE object_id = ? AND day < ? ORDER BY day DESC").all(id, localDay(now)) as any[];
  return rows.map((r) => ({ day: r.day as string, paragraphs: (JSON.parse(r.paragraphs) as string[]).map((p) => p.replace(MENTION, (_m, i) => `“${titleOf(db, i)}”`)) }));
}

// ---------- Open Questions ----------

type Question = { id: string; title: string; private: boolean; state: "open" | "settled"; openedAt: string; settledAt: string | null; settledBy: { id: string; title: string } | null; touchedAt: string };

const questionRow = (db: Db, r: any): Question => {
  const by = r.settled_by ? live(db, r.settled_by) : null;
  return {
    id: r.id, title: titleOf(db, r.id), private: !!r.private, state: r.settled_at ? "settled" : "open",
    openedAt: iso(r.opened_at)!, settledAt: iso(r.settled_at), settledBy: by ? { id: by.id, title: titleOf(db, by.id) } : null,
    touchedAt: iso(r.updated_at ?? r.created_at)!,
  };
};
const QUESTION_SQL = `SELECT o.id, o.private, o.created_at, o.updated_at, q.opened_at, q.settled_at, q.settled_by
                      FROM open_questions q JOIN objects o ON o.id = q.object_id AND o.deleted_at IS NULL AND o.type = 'thought'`;

export function questionOf(db: Db, id: string): Question | null {
  const r = db.prepare(`${QUESTION_SQL} WHERE o.id = ?`).get(id);
  return r ? questionRow(db, r) : null;
}

/** Mark a Thought as an Open Question, settle it ("settled for now", optionally pointing to the Thought that did), reopen it, or let it go. Only the owner calls this. */
export function setQuestion(db: Db, id: string, input: { state?: unknown; settledBy?: unknown }) {
  const o = live(db, id);
  if (!o) return undefined;
  if (o.type !== "thought") throw new BadRequest("Only a Thought can be an Open Question");
  const had = db.prepare("SELECT * FROM open_questions WHERE object_id = ?").get(id) as any;
  const state = input.state;
  if (state === "none") db.prepare("DELETE FROM open_questions WHERE object_id = ?").run(id);
  else if (state === "open") {
    if (!had) db.prepare("INSERT INTO open_questions (object_id) VALUES (?)").run(id);
    else db.prepare("UPDATE open_questions SET settled_at = NULL, settled_by = NULL WHERE object_id = ?").run(id); // reopened
  } else if (state === "settled") {
    if (!had) throw new BadRequest("Mark it as an Open Question first");
    let by: string | null = null;
    if (typeof input.settledBy === "string" && input.settledBy) {
      const t = live(db, input.settledBy);
      const joined = db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, input.settledBy, input.settledBy, id);
      if (!t || t.type !== "thought" || !joined) throw new BadRequest("Pick a Thought that is connected to this one");
      by = t.id;
    }
    db.prepare("UPDATE open_questions SET settled_at = datetime('now'), settled_by = ? WHERE object_id = ?").run(by, id);
  } else throw new BadRequest("state must be open, settled or none");
  return questionOf(db, id);
}

/** Every Open Question, open ones first, with the Concepts they sit in. Under More > Questions. */
export function allQuestions(db: Db) {
  const rows = (db.prepare(`${QUESTION_SQL} ORDER BY o.rowid`).all() as any[]).map((r) => questionRow(db, r));
  const concepts = (id: string) =>
    (db.prepare(
      `SELECT o.id FROM connections c JOIN objects o ON o.id = CASE WHEN c.from_id = ? THEN c.to_id ELSE c.from_id END AND o.deleted_at IS NULL AND o.type = 'concept'
       WHERE c.from_id = ? OR c.to_id = ?`,
    ).all(id, id, id) as any[]).map((c) => ({ id: c.id as string, title: titleOf(db, c.id) }));
  const withConcepts = rows.map((q) => ({ ...q, concepts: concepts(q.id) }));
  const open = withConcepts.filter((q) => q.state === "open").sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const settled = withConcepts.filter((q) => q.state === "settled").sort((a, b) => (b.settledAt ?? "").localeCompare(a.settledAt ?? ""));
  return { open, settled };
}

// ---------- The desk ----------

const GROUPS = [
  { key: "supports", label: "Supports", kinds: ["supports"] },
  { key: "contradicts", label: "Contradicts", kinds: ["contradicts"] },
  { key: "builds on", label: "Builds on", kinds: ["builds on"] },
  { key: "related", label: "Related", kinds: ["related", "mentions", "inspired by", "authored by"] },
];
const SENSE: Record<string, [string, string]> = {
  related: ["related", "related"], supports: ["supports", "supported by"], contradicts: ["contradicts", "contradicts"], "builds on": ["builds on", "built on by"],
  "inspired by": ["inspired by", "inspired"], mentions: ["mentions", "mentioned by"], "authored by": ["authored by", "author of"], "part of": ["part of", "has part"],
};

/** Only Connections the owner made or approved count (a pending Suggestion is not a Connection). */
const counts = (c: any) => !(c.origin === "ai" && !c.approved);

export function deskOf(db: Db, id: string, now = new Date()) {
  const me = live(db, id);
  if (!me || me.type !== "concept") return null;
  const conns = (db.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ? ORDER BY id").all(id, id) as any[]).filter(counts);
  const rows = conns.flatMap((c) => {
    const subject = c.from_id === id;
    const other = live(db, subject ? c.to_id : c.from_id);
    if (!other || other.id === id) return [];
    return [{
      connectionId: c.id as number, ...brief(db, other), kind: c.kind as string, label: SENSE[c.kind]?.[subject ? 0 : 1] ?? c.kind,
      approved: c.origin === "ai" && !!c.approved, changedAt: iso(other.updated_at ?? other.created_at)!,
    }];
  });
  rows.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const groups = GROUPS.map((g) => ({ key: g.key, label: g.label, items: rows.filter((r) => g.kinds.includes(r.kind)) }));
  const mix: Record<string, number> = {};
  for (const r of rows) mix[r.type] = (mix[r.type] ?? 0) + 1;
  const inside = new Set(rows.map((r) => r.id));

  // Tensions: two Objects in this Concept that contradict each other.
  const tensions: { a: ReturnType<typeof brief>; b: ReturnType<typeof brief>; connectionId: number }[] = [];
  const seen = new Set<number>();
  for (const r of rows) {
    for (const c of (db.prepare("SELECT * FROM connections WHERE kind = 'contradicts' AND (from_id = ? OR to_id = ?)").all(r.id, r.id) as any[]).filter(counts)) {
      const otherId = c.from_id === r.id ? c.to_id : c.from_id;
      if (seen.has(c.id) || otherId === id || !inside.has(otherId)) continue;
      seen.add(c.id);
      tensions.push({ a: brief(db, live(db, r.id)), b: brief(db, live(db, otherId)), connectionId: c.id });
    }
  }

  const questions = rows.filter((r) => r.type === "thought").flatMap((r) => { const q = questionOf(db, r.id); return q ? [q] : []; });
  questions.sort((a, b) => (a.state === b.state ? a.openedAt.localeCompare(b.openedAt) : a.state === "open" ? -1 : 1));
  // Pending Suggestions only ever show as a number; Private Objects are never sent to the AI, so say how many won't be.
  const suggested = suggestionsOf(db, id)?.pending.filter((s) => s.kind === "connection").length ?? 0;
  return {
    id, createdAt: iso(me.created_at)!, total: rows.length, mix, groups, tensions, questions, suggested,
    privateCount: rows.filter((r) => r.private).length + (me.private ? 1 : 0),
    versions: versionsOf(db, id, now),
  };
}

/** "Write a Thought about these": an empty Thought (the owner's), connected to both Objects as "related" (they can change the kind). */
export function thoughtAbout(db: Db, input: { a?: unknown; b?: unknown }) {
  const { a, b } = input;
  if (typeof a !== "string" || typeof b !== "string" || a === b) throw new BadRequest("two different Objects are needed");
  if (!live(db, a) || !live(db, b)) throw new BadRequest("That Object could not be found");
  return db.transaction(() => {
    const t = createObject(db, { type: "thought" });
    const ins = db.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'related', 'owner')");
    ins.run(t.id, a); ins.run(t.id, b);
    return t.id as string;
  })();
}

// ---------- From your Garden ----------

const DAY = 864e5;
/** A steady pick for the day: the same day gives the same order, a new day shuffles. */
const rank = (id: string, day: string) => { let h = 2166136261; for (const ch of id + day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const monthsAgo = (ms: number) => Math.max(1, Math.round(ms / (30 * DAY)));
const ago = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

/**
 * 2–3 older Objects, each with a reason, worked out here from dates and Connections (no AI, no count). Unreviewed Objects,
 * Bin Objects and anything the owner dismissed never appear. At most one Open Question a day; Private Objects may appear.
 */
export function fromYourGarden(db: Db, now = new Date()) {
  const day = localDay(now);
  const t = now.getTime();
  const all = (db.prepare("SELECT * FROM objects WHERE deleted_at IS NULL AND unreviewed = 0 AND id NOT IN (SELECT object_id FROM garden_dismissed)").all() as any[]);
  const changed = (o: any) => asDate(o.updated_at ?? o.created_at)!.getTime();
  const made = (o: any) => asDate(o.created_at)!.getTime();
  const picked: { o: any; reason: string }[] = [];
  const take = (list: { o: any; reason: string }[]) => {
    for (const x of list.sort((a, b) => rank(a.o.id, day) - rank(b.o.id, day))) {
      if (picked.length >= 3) return;
      if (!picked.some((p) => p.o.id === x.o.id)) { picked.push(x); return; }
    }
  };
  const older = (o: any) => t - changed(o) > 14 * DAY;

  const questions = all.filter((o) => o.type === "thought" && older(o) && t - changed(o) > 60 * DAY && db.prepare("SELECT 1 FROM open_questions WHERE object_id = ? AND settled_at IS NULL").get(o.id));
  take(questions.map((o) => ({ o, reason: `An open question you haven't touched in ${ago(monthsAgo(t - changed(o)), "month")}` })));

  const fresh = new Set(all.filter((o) => t - made(o) < 7 * DAY).map((o) => o.id));
  const newly: { o: any; reason: string }[] = [];
  for (const o of all.filter(older)) {
    const link = (db.prepare("SELECT from_id, to_id FROM connections WHERE from_id = ? OR to_id = ?").all(o.id, o.id) as any[]).map((c) => (c.from_id === o.id ? c.to_id : c.from_id)).find((x) => fresh.has(x));
    if (link) newly.push({ o, reason: `Just got a new Connection, from ${titleOf(db, link)}` });
  }
  take(newly);

  const yearAgo = all.filter((o) => Math.abs(t - made(o) - 365 * DAY) <= 3 * DAY);
  take(yearAgo.map((o) => ({ o, reason: "A year ago this week" })));

  // Fill up with other older things so the strip is rarely empty.
  const rest = all.filter((o) => older(o) && t - made(o) > 30 * DAY && !picked.some((p) => p.o.id === o.id));
  while (picked.length < 2 && rest.length) {
    const before = picked.length;
    take(rest.map((o) => ({ o, reason: `From ${ago(monthsAgo(t - made(o)), "month")} ago` })));
    if (picked.length === before) break;
  }
  return { items: picked.map((p) => ({ ...brief(db, p.o), reason: p.reason })) };
}

export function dismissFromGarden(db: Db, id: unknown) {
  if (typeof id !== "string" || !live(db, id)) throw new BadRequest("That Object could not be found");
  db.prepare("INSERT OR IGNORE INTO garden_dismissed (object_id) VALUES (?)").run(id);
  return { dismissed: true };
}
