// The owner's comments from phone captures (issue #63), read for Search and for the AI.
// A comment lives with its Daily Inbox entry (inbox.ts); this only reads it, so editing the comment there is all it takes
// for Search and the AI to see the new words. Once it has been turned into a Thought it is no longer a comment on the Source.
import type Database from "better-sqlite3";

type Db = Database.Database;

/** Every live comment with the Objects it was sent with. The owner's own search reads all of them, Private ones included. */
export function allComments(db: Db): { objectId: string; text: string; captureId: number }[] {
  return (db
    .prepare(
      `SELECT io.object_id, c.comment, c.id FROM inbox_objects io JOIN inbox_captures c ON c.id = io.capture_id
       JOIN objects o ON o.id = io.object_id AND o.deleted_at IS NULL
       WHERE c.status = 'done' AND c.comment IS NOT NULL AND trim(c.comment) <> '' AND c.thought_id IS NULL`,
    )
    .all() as any[]).map((r) => ({ objectId: r.object_id as string, text: r.comment as string, captureId: r.id as number }));
}

/**
 * The comment an AI role may read with this Source: the owner's words, or null. Never from a Private capture or for a
 * Private Object, so a Private Source's comment is never sent anywhere.
 */
export function commentForAi(db: Db, objectId: string): string | null {
  const o = db.prepare("SELECT private FROM objects WHERE id = ? AND deleted_at IS NULL").get(objectId) as any;
  if (!o || o.private) return null;
  const r = db
    .prepare(
      `SELECT c.comment FROM inbox_objects io JOIN inbox_captures c ON c.id = io.capture_id
       WHERE io.object_id = ? AND c.status = 'done' AND c.private = 0 AND c.comment IS NOT NULL AND trim(c.comment) <> '' AND c.thought_id IS NULL
       ORDER BY c.sent_at DESC LIMIT 1`,
    )
    .get(objectId) as any;
  return r ? (r.comment as string) : null;
}
