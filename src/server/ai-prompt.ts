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

/** Words that are never a useful Tag: they name the format or say nothing about what an item is about. */
export const VAGUE_TAGS = new Set(
  "article articles book books video videos podcast podcasts image images document documents web page link reading read notes note thoughts ideas idea interesting general misc other stuff information content internet online research learning knowledge culture society business life world people things thing important useful".split(" "),
);

/** Tags too broad for the AI to keep adding: carried by many Objects and by more than a quarter of the Garden (issue: the same Tag over and over). */
export function broadTags(db: Db): Set<string> {
  const total = (db.prepare("SELECT count(*) AS n FROM objects WHERE private = 0 AND deleted_at IS NULL").get() as any).n as number;
  const rows = db
    .prepare(
      `SELECT t.name, count(*) AS n FROM tags t JOIN object_tags ot ON ot.tag_id = t.id JOIN objects o ON o.id = ot.object_id
       WHERE o.private = 0 AND o.deleted_at IS NULL GROUP BY t.id`,
    )
    .all() as any[];
  return new Set(rows.filter((r) => r.n >= AI_CONFIG.broadTagMin && r.n > total * 0.25).map((r) => r.name as string));
}

/** Tags the AI may be told about: only those carried by Objects it is allowed to read, with how often each is used. The broad ones are left out. */
export function knownTags(db: Db): string[] {
  const broad = broadTags(db);
  return (db
    .prepare(
      `SELECT t.name, count(*) AS n FROM tags t JOIN object_tags ot ON ot.tag_id = t.id JOIN objects o ON o.id = ot.object_id
       WHERE o.private = 0 AND o.deleted_at IS NULL GROUP BY t.id ORDER BY t.name LIMIT 150`,
    )
    .all() as any[]).filter((r) => !broad.has(r.name) && !VAGUE_TAGS.has(r.name)).map((r) => `${r.name} (${r.n})`);
}

/** Long text cut to fit: the beginning and the end are kept (an article's argument and its conclusion), the middle is marked as left out. */
export function clip(text: string, cap: number): string {
  if (text.length <= cap) return text;
  const head = Math.floor(cap * 0.7), tail = cap - head;
  return `${text.slice(0, head)}\n[… middle of the text left out …]\n${text.slice(text.length - tail)}`;
}

export type Candidate = { ref: string; id: string; type: string; title: string };

/** What an Object says in its own words, briefly, so a Connection can be judged on content and not only on the title. Never for a Private Object. */
export function excerptOf(db: Db, id: string, cap: number): string {
  if (!readable(db, id)) return "";
  const own = db.prepare("SELECT text FROM blocks WHERE object_id = ? AND origin = 'owner' ORDER BY position").all(id) as any[];
  const field = (f: string) => (db.prepare("SELECT value FROM field_values WHERE object_id = ? AND field = ?").get(id, f) as any)?.value as string | undefined;
  const parts: string[] = [];
  const by = field("authors");
  if (by) parts.push(`by ${by}`);
  const mine = cleanText(db, own.map((b) => b.text).join(" ")).replace(/\s+/g, " ");
  if (mine) parts.push(`the owner wrote: ${mine}`);
  const extract = field("captured");
  if (extract) parts.push(`text starts: ${extract.replace(/\s+/g, " ")}`);
  const tags = (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[]).map((r) => r.name);
  if (tags.length) parts.push(`tags: ${tags.slice(0, 6).join(", ")}`);
  return parts.join(" | ").slice(0, cap + 80);
}
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

const SYSTEM = `You are the Archivist in a personal knowledge Garden. You READ one newly captured item carefully, all of it, and describe what it contributes.
Answer with ONE JSON object and nothing else, in this shape:
{"format": string or null, "title": string or null, "authors": string or null, "published": string or null,
 "summary": string or null, "claims": [{"claim": string, "kind": "reported" or "interpretation", "by": string or null}],
 "tags": [string], "people": [{"name": string, "central": boolean}], "type": string or null, "thoughtTitle": string or null,
 "properties": {property key: string or null}}
Rules:
- "format" is one of: book, article, video, podcast, web page, image, document. Use null if unsure.
- "title", "authors" and "published" are facts about the item itself (published as YYYY, YYYY-MM or YYYY-MM-DD). Use null unless the text shows them. Never invent.
- "summary" is 3 to 5 plain sentences, for a Source only: what the item argues or reports, its main thread, and why it might matter. Base it on the whole text, not only the opening. It is clearly yours, never the owner's voice; null if there is too little text.
- "claims" are the 3 to 6 most important things the TEXT itself says, for a Source only. "reported" is a fact, figure or event the text states. "interpretation" is the author's (or a quoted person's) view, argument or judgement, and "by" names who holds it. Every claim must be in the text: never add your own knowledge or opinion. [] if there is too little text.
- "tags" are 2 to 4 lowercase noun phrases of 1 to 3 words. Each must name something SPECIFIC the item is really about: an idea, mechanism, event, place, school of thought or technique. Never a format word (article, book, video), never a vague word (ideas, interesting, culture, business, society, learning). A tag that would fit most items in a Garden is wrong. A precise new tag is better than a known one that is only roughly right: reuse a known Tag only when it is exactly this item's subject. Known Tags are listed with how often each is used; do not pick one because it is popular.
- "people" lists people the item is by or mainly about. "central" is true only if the item is mainly about that person.
- "type" is "source" or "person" only if the Kind of Object is clearly wrong, else null.
- "thoughtTitle" is a short title, only for a Thought that has none, else null.
- "properties" is only for an Object whose kind lists "Properties" below, and uses only the keys listed there; otherwise {}. Fill a property only with a fact the text itself states, copied as the text words it (a choice must be exactly one of its options). If the text does not state it, leave it out. Never guess, never use your own knowledge, never write an opinion.
- Never write opinions, summaries or anything in the owner's voice. Text marked "the owner's words" is theirs; you only describe, you never rewrite it.`;

/** What the Archivist is shown about one Object, or null if it may not read it. */
export function archivistPrompt(db: Db, id: string, image?: { dataUrl: string }): ArchivistPrompt | null {
  const o = live(db, id);
  if (!o || o.private) return null;
  const fields = db.prepare("SELECT * FROM field_values WHERE object_id = ? AND field NOT IN ('extraction')").all(id) as any[];
  const blocks = db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(id) as any[];
  const own = db.prepare("SELECT label, core FROM object_types WHERE key = ?").get(o.type) as any;
  const lines: string[] = [`Kind of Object: ${own && !own.core ? own.label : o.type}`];
  if (own && !own.core) {
    const props = db.prepare("SELECT fd.key, fd.label, fd.input, fd.options FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? ORDER BY tf.position").all(o.type) as any[];
    // A kind the owner made is a plain Object: tags and Connections like any other, plus its own properties to fill from the text.
    if (props.length) lines.push(`Properties of this kind (key: name, how it is filled):\n${props.map((p) => `- ${p.key}: ${p.label}, ${p.input === "select" ? `one of ${p.options}` : p.input === "longtext" ? "a short description of 1 to 3 sentences" : "a short value"}`).join("\n")}`);
  }
  // The extract (the words read from the page) is the heart of a Source, so it is read in full, not as a short first part.
  for (const f of fields) lines.push(`${f.field.startsWith("c-") ? (db.prepare("SELECT label FROM field_definitions WHERE key = ?").get(f.field) as any)?.label ?? f.field : f.field}${f.field === "captured" ? " (the extract, the item's own text)" : ""} (${labelOf(f)}): ${clip(String(f.value), f.field === "captured" ? AI_CONFIG.readChars : 3000)}`);
  const body = blocks.map((b) => ({ ...b, text: cleanText(db, b.text) })).filter((b) => b.text);
  if (body.length) {
    lines.push("Text:");
    for (const b of body) lines.push(`- (${labelOf(b)}) ${clip(b.text, 6000)}`);
  }
  // The owner's comment sent with this capture from the phone: their words, so it is labelled that way (issue #63).
  const comment = commentForAi(db, id);
  if (comment) lines.push(`Comment sent with it (the owner's words): ${cleanText(db, comment).slice(0, 3000)}`);
  const tags = db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[];
  if (tags.length) lines.push(`Tags already on it: ${tags.map((t) => t.name).join(", ")}`);
  if (o.type === "thought") lines.push("This is a Thought, the owner's own. Only \"tags\" and \"thoughtTitle\" may be filled; leave everything else empty.");
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden (use count): ${known.join(", ")}`);
  const text = lines.join("\n");
  const content = image ? [{ type: "text", text }, { type: "image_url", image_url: { url: image.dataUrl } }] : text;
  return { messages: [{ role: "system", content: SYSTEM }, { role: "user", content }], wantsImage: !!image, type: o.type, candidates: candidatesFor(db, id) };
}

const CONNECT_SYSTEM = `You are the Archivist in a personal knowledge Garden. You have just read one new item. Now judge which existing Objects it truly connects to, using what each says, not only its title.
Answer with ONE JSON object and nothing else:
{"related": [{"ref": string, "why": string}], "specific": [{"ref": string, "kind": "supports" or "contradicts" or "builds on" or "inspired by", "why": string}]}
Rules:
- Refs (like "c2") come only from the list of Objects. Never invent a ref. [] if none fit.
- "related": the Object is genuinely about the same subject, person or idea as the new item. At most ${AI_CONFIG.maxConnections}. Sharing a broad theme or a common word is not enough. "why" is one short sentence naming what they share.
- "specific": use only when the text of both clearly shows the relationship. "supports": one gives evidence or an argument for the other. "contradicts": they disagree or the findings conflict; in "why" say whether it is a direct contradiction, a difference of context, time or method, or a different reading of the same evidence. "builds on": one extends or develops the other. "inspired by": one explicitly draws on the other. At most 3. When in doubt, leave it out.
- An Object listed in "specific" must not also be in "related".
- Never write opinions or anything in the owner's voice.`;

/** The second Archivist request: the item just read (its summary, claims and Tags) against what the candidates actually say. */
export function connectPrompt(db: Db, id: string, read: { title?: string; summary?: string; claims: string[]; tags: string[] }, candidates: Candidate[]) {
  const o = live(db, id);
  const lines = [`The new item: "${read.title ?? titleOf(db, id)}" (${o?.type ?? "source"})`];
  if (read.summary) lines.push(`What it says (written by you): ${read.summary}`);
  if (read.claims.length) lines.push(`Its main claims:\n${read.claims.map((c) => `- ${c}`).join("\n")}`);
  if (read.tags.length) lines.push(`Its Tags: ${read.tags.join(", ")}`);
  lines.push(`Objects it could be connected to:\n${candidates.map((c) => `${c.ref}: "${c.title}" (${c.type}) — ${excerptOf(db, c.id, AI_CONFIG.candidateChars) || "no text"}`).join("\n")}`);
  return [{ role: "system" as const, content: CONNECT_SYSTEM }, { role: "user" as const, content: lines.join("\n") }];
}
