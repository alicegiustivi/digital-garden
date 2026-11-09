// Building what the AI is shown. This is where "Private" is kept (CONTEXT.md: Private): an Object marked Private,
// or in the Bin, is never turned into a prompt, a Mention of one is cut out of the text, and nothing about a Private
// Object (its title, its Tags, even that it exists) is passed along. Every piece is labelled with its Origin (ADR 0001).
import type Database from "better-sqlite3";
import { MENTION } from "./mentions.ts";
import { titleOf } from "./objects.ts";
import { sharesWords } from "./connections.ts";
import { AI_CONFIG } from "./ai-config.ts";
import { commentForAi } from "./inbox-comments.ts";

type Db = Database.Database;

const live = (db: Db, id: string) => db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any | undefined;
/** Can the AI see this Object at all? */
export const readable = (db: Db, id: string) => {
  const o = live(db, id);
  return !!o && !o.private;
};

const labelOf = (r: any) => (r.origin === "owner" ? "the owner's words" : r.origin === "source" ? "from the Source" : "written by AI");

/** The owner's text with every Mention of an unreadable Object cut out, and readable ones named by title. */
export function cleanText(db: Db, text: string): string {
  return text
    .replace(MENTION, (_, id: string) => (readable(db, id) ? `(mentions "${titleOf(db, id)}")` : ""))
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** Tags the AI may be told about: only those carried by Objects it is allowed to read. */
export function knownTags(db: Db): string[] {
  return (db
    .prepare(
      `SELECT t.name FROM tags t JOIN object_tags ot ON ot.tag_id = t.id JOIN objects o ON o.id = ot.object_id
       WHERE o.private = 0 AND o.deleted_at IS NULL GROUP BY t.id ORDER BY count(*) DESC, t.name LIMIT 40`,
    )
    .all() as any[]).map((r) => r.name);
}

export type Candidate = { ref: string; id: string; type: string; title: string };
export type ArchivistPrompt = { messages: any[]; wantsImage: boolean; type: string; candidates: Candidate[] };

/**
 * The Objects the Archivist may propose to connect this one to: readable (never Private, never in the Bin), not a Thought
 * (a Suggestion never touches a Thought), not already connected, and not turned down before. At most 15, each with a short ref.
 * Ranked on this Mac by shared words and Tags, then topped up with People (for "authored by") and the most recently changed
 * Objects, so the Archivist has a fair pool to judge from. Only titles and types are shown, never content.
 */
export function candidatesFor(db: Db, id: string): Candidate[] {
  const me = live(db, id);
  if (!me || me.private || me.type === "thought") return [];
  const connected = new Set((db.prepare("SELECT from_id, to_id FROM connections WHERE from_id = ? OR to_id = ?").all(id, id) as any[]).flatMap((c) => [c.from_id, c.to_id]));
  const turnedDown = new Set((db.prepare("SELECT value FROM ai_rejected WHERE object_id = ? AND kind = 'connection'").all(id) as any[]).map((r) => r.value));
  const ok = (oid: string) => oid !== id && !connected.has(oid) && !turnedDown.has(oid) && readable(db, oid) && live(db, oid).type !== "thought";
  const ids: string[] = [];
  for (const s of sharesWords(db, id) ?? []) if (ok(s.id)) ids.push(s.id);
  const people = db.prepare("SELECT id FROM objects WHERE type = 'person' AND private = 0 AND deleted_at IS NULL ORDER BY coalesce(updated_at, created_at) DESC LIMIT 30").all() as any[];
  for (const p of people) if (ok(p.id) && !ids.includes(p.id)) ids.push(p.id);
  const recent = db.prepare("SELECT id FROM objects WHERE type <> 'thought' AND private = 0 AND deleted_at IS NULL ORDER BY coalesce(updated_at, created_at) DESC, rowid DESC LIMIT 40").all() as any[];
  for (const r of recent) if (ok(r.id) && !ids.includes(r.id)) ids.push(r.id);
  return ids.slice(0, 15).map((oid, i) => ({ ref: `c${i + 1}`, id: oid, type: live(db, oid).type, title: titleOf(db, oid) }));
}

const SYSTEM = `You are the Archivist in a personal knowledge Garden. You look at one newly captured item and describe it.
Answer with ONE JSON object and nothing else, in this shape:
{"format": string or null, "title": string or null, "authors": string or null, "published": string or null, "tags": [string],
 "summary": string or null, "related": [string], "people": [{"name": string, "central": boolean}], "type": string or null, "thoughtTitle": string or null}
Rules:
- "format" is one of: book, article, video, podcast, web page, image, document. Use null if unsure.
- "title", "authors" and "published" are facts about the item itself (published as YYYY, YYYY-MM or YYYY-MM-DD). Use null unless the text shows them. Never invent.
- "tags" are at most 5 short lowercase words or hyphenated phrases. Reuse a known Tag when it fits.
- "summary" is 2 or 3 plain sentences saying what the item says, for a Source only. It is clearly yours, never the owner's voice; null if there is too little text.
- "related" lists the refs (like "c2") of Objects from the list "Objects it could be connected to" that really are about the same thing. At most ${AI_CONFIG.maxConnections}. Use [] if none fit; never invent a ref.
- "people" lists people the item is by or mainly about. "central" is true only if the item is mainly about that person.
- "type" is "source" or "person" only if the Kind of Object is clearly wrong, else null.
- "thoughtTitle" is a short title, only for a Thought that has none, else null.
- Never write opinions, summaries or anything in the owner's voice. Text marked "the owner's words" is theirs; you only describe, you never rewrite it.`;

/** What the Archivist is shown about one Object, or null if it may not read it. */
export function archivistPrompt(db: Db, id: string, image?: { dataUrl: string }): ArchivistPrompt | null {
  const o = live(db, id);
  if (!o || o.private) return null;
  const fields = db.prepare("SELECT * FROM field_values WHERE object_id = ? AND field NOT IN ('extraction')").all(id) as any[];
  const blocks = db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(id) as any[];
  const lines: string[] = [`Kind of Object: ${o.type}`];
  for (const f of fields) lines.push(`${f.field} (${labelOf(f)}): ${String(f.value).slice(0, 6000)}`);
  const body = blocks.map((b) => ({ ...b, text: cleanText(db, b.text) })).filter((b) => b.text);
  if (body.length) {
    lines.push("Text:");
    for (const b of body) lines.push(`- (${labelOf(b)}) ${b.text.slice(0, 3000)}`);
  }
  // The owner's comment sent with this capture from the phone: their words, so it is labelled that way (issue #63).
  const comment = commentForAi(db, id);
  if (comment) lines.push(`Comment sent with it (the owner's words): ${cleanText(db, comment).slice(0, 3000)}`);
  const tags = db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[];
  if (tags.length) lines.push(`Tags already on it: ${tags.map((t) => t.name).join(", ")}`);
  const cands = candidatesFor(db, id);
  if (cands.length) lines.push(`Objects it could be connected to:\n${cands.map((c) => `${c.ref}: ${c.title} (${c.type})`).join("\n")}`);
  if (o.type === "thought") lines.push("This is a Thought, the owner's own. Only \"tags\" and \"thoughtTitle\" may be filled; leave everything else empty.");
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden: ${known.join(", ")}`);
  const text = lines.join("\n");
  const content = image ? [{ type: "text", text }, { type: "image_url", image_url: { url: image.dataUrl } }] : text;
  return { messages: [{ role: "system", content: SYSTEM }, { role: "user", content }], wantsImage: !!image, type: o.type, candidates: cands };
}
