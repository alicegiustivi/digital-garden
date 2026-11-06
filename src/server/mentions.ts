// A Mention is a reference to another Object written inside a body, stored as [[o:<id>]] (issue #7).
// It makes a Connection of kind "mentions" that follows the text: it goes when the reference goes, unless the owner
// gave that Connection another kind. Nothing else about Connections is ever written into the text.
import type Database from "better-sqlite3";

type Db = Database.Database;

export const MENTION = /\[\[o:([0-9a-f-]{36})\]\]/g;
export const mentionToken = (id: string) => `[[o:${id}]]`;
export const mentionIds = (text: string) => [...text.matchAll(MENTION)].map((m) => m[1]);

const bodyText = (db: Db, id: string) => (db.prepare("SELECT text FROM blocks WHERE object_id = ?").all(id) as any[]).map((b) => b.text).join("\n");
export const mentionsInBody = (db: Db, id: string) => new Set(mentionIds(bodyText(db, id)));

/** Bring this Object's "mentions" Connections in line with what its body now says. */
export function syncMentions(db: Db, id: string) {
  const raw = mentionsInBody(db, id);
  const mentioned = new Set([...raw].filter((m) => m !== id && db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(m)));
  const pair = db.prepare("SELECT * FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)");
  const insert = db.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'mentions', 'owner')");
  for (const m of mentioned) if (!pair.get(id, m, m, id)) insert.run(id, m);
  const mine = db.prepare("SELECT * FROM connections WHERE from_id = ? AND kind = 'mentions'").all(id) as any[];
  for (const c of mine) {
    if (mentioned.has(c.to_id) || raw.has(c.to_id)) continue; // (a Mention of something in the Bin keeps its hidden Connection)
    // The text no longer mentions it. If the other Object's text still mentions this one, the Connection stays, the other way round.
    if (mentionsInBody(db, c.to_id).has(id)) db.prepare("UPDATE connections SET from_id = ?, to_id = ? WHERE id = ?").run(c.to_id, c.from_id, c.id);
    else db.prepare("DELETE FROM connections WHERE id = ?").run(c.id);
  }
}
