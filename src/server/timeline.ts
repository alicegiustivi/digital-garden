// The Timeline (issue #33): what was captured, written, connected and asked, newest first. The page groups it by day.
// Worked out from dates the Garden already keeps; nothing is stored for it. "Asked" is for Inquiries, which arrive with the Researcher.
import type Database from "better-sqlite3";
import { summarise, titleOf } from "./objects.ts";

type Db = Database.Database;
export type TimelineEvent = {
  kind: "captured" | "written" | "connected";
  /** For "written": whether the Object was started then, or changed then. */
  detail: "started" | "edited" | null;
  at: string;
  object: { id: string; type: string; title: string; private: boolean };
  /** For "connected": the other end and how the two relate. */
  other: { id: string; type: string; title: string; private: boolean } | null;
  connectionKind: string | null;
};
const iso = (s: string) => s.replace(" ", "T") + "Z";
const sqlTime = (s: string) => s.replace("T", " ").replace(/\.\d+Z$|Z$/, "");
/** An Object's date of last change only counts as an edit if it is clearly later than its making. */
const EDIT_GAP = "5 minutes";

export function timeline(db: Db, q: { before?: string; limit?: number }) {
  const limit = Math.min(Math.max(q.limit ?? 80, 1), 300);
  const before = q.before ? sqlTime(q.before) : "9999-12-31 00:00:00";
  const objects = db
    .prepare(
      `SELECT o.id, o.captured, o.created_at AS at, 'started' AS detail FROM objects o WHERE o.deleted_at IS NULL AND o.created_at < @before
       UNION ALL
       SELECT o.id, 0, o.updated_at, 'edited' FROM objects o WHERE o.deleted_at IS NULL AND o.updated_at < @before AND o.updated_at > datetime(o.created_at, '+${EDIT_GAP}')
       ORDER BY at DESC LIMIT @limit`,
    )
    .all({ before, limit }) as any[];
  const links = db
    .prepare(
      `SELECT c.from_id, c.to_id, c.kind, c.created_at AS at FROM connections c
       JOIN objects a ON a.id = c.from_id AND a.deleted_at IS NULL JOIN objects b ON b.id = c.to_id AND b.deleted_at IS NULL
       WHERE c.created_at < ? ORDER BY c.created_at DESC, c.id DESC LIMIT ?`,
    )
    .all(before, limit) as any[];

  const merged = [
    ...objects.map((r) => ({ at: r.at as string, row: r, link: false })),
    ...links.map((r) => ({ at: r.at as string, row: r, link: true })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);

  const ids = [...new Set(merged.flatMap((m) => (m.link ? [m.row.from_id, m.row.to_id] : [m.row.id])))];
  const brief = new Map(
    summarise(db, ids.map((id) => db.prepare("SELECT * FROM objects WHERE id = ?").get(id)).filter(Boolean)).map((s) => [s.id, { id: s.id, type: s.type, title: titleOf(db, s.id), private: s.private }]),
  );
  const events: TimelineEvent[] = merged.map((m) =>
    m.link
      ? { kind: "connected", detail: null, at: iso(m.at), object: brief.get(m.row.from_id)!, other: brief.get(m.row.to_id)!, connectionKind: m.row.kind }
      : { kind: m.row.detail === "started" && m.row.captured ? "captured" : "written", detail: m.row.detail, at: iso(m.at), object: brief.get(m.row.id)!, other: null, connectionKind: null },
  );
  return { events, next: merged.length >= limit ? events[events.length - 1].at : null };
}
