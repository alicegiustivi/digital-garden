// Building what the AI is shown. This is where "Private" is kept (CONTEXT.md: Private): an Object marked Private,
// or in the Bin, is never turned into a prompt, a Mention of one is cut out of the text, and nothing about a Private
// Object (its title, its Tags, even that it exists) is passed along. Every piece is labelled with its Origin (ADR 0001).
import type Database from "better-sqlite3";
import { MENTION } from "./mentions.ts";
import { titleOf } from "./objects.ts";

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

export type ArchivistPrompt = { messages: any[]; wantsImage: boolean; type: string };

const SYSTEM = `You are the Archivist in a personal knowledge Garden. You look at one newly captured item and describe it.
Answer with ONE JSON object and nothing else, in this shape:
{"format": string or null, "title": string or null, "authors": string or null, "published": string or null, "tags": [string]}
Rules:
- "format" is one of: book, article, video, podcast, web page, image, document. Use null if unsure.
- "title", "authors" and "published" are facts about the item itself (published as YYYY, YYYY-MM or YYYY-MM-DD). Use null unless the text shows them. Never invent.
- "tags" are at most 5 short lowercase words or hyphenated phrases. Reuse a known Tag when it fits.
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
  const tags = db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[];
  if (tags.length) lines.push(`Tags already on it: ${tags.map((t) => t.name).join(", ")}`);
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden: ${known.join(", ")}`);
  const text = lines.join("\n");
  const content = image ? [{ type: "text", text }, { type: "image_url", image_url: { url: image.dataUrl } }] : text;
  return { messages: [{ role: "system", content: SYSTEM }, { role: "user", content }], wantsImage: !!image, type: o.type };
}
