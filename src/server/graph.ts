// The Map (issue #82): everything needed to draw the whole Garden as a graph, in one read.
// The owner's own view, so Private Objects are included (and flagged); Bin Objects and their Connections are left out.
// Nothing here calls an AI or leaves the Mac.
import type Database from "better-sqlite3";
import { titleOf } from "./objects.ts";

export function graph(db: Database.Database) {
  const rows = db.prepare("SELECT id, type, private, created_at, coalesce(updated_at, created_at) AS changed FROM objects WHERE deleted_at IS NULL").all() as any[];
  const tagRows = db.prepare("SELECT ot.object_id AS id, t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id").all() as any[];
  const tags = new Map<string, string[]>();
  for (const t of tagRows) tags.set(t.id, [...(tags.get(t.id) ?? []), t.name]);
  const nodes = rows.map((r) => ({ id: r.id as string, type: r.type as string, title: titleOf(db, r.id), private: !!r.private, tags: tags.get(r.id) ?? [], created: r.created_at as string, changed: r.changed as string }));
  const live = new Set(nodes.map((n) => n.id));
  const edges = (db.prepare("SELECT id, from_id, to_id, kind, origin, approved FROM connections").all() as any[])
    .filter((c) => live.has(c.from_id) && live.has(c.to_id) && c.from_id !== c.to_id)
    .map((c) => ({ id: c.id as number, from: c.from_id as string, to: c.to_id as string, kind: c.kind as string, origin: c.origin as string, approved: c.origin === "ai" && !!c.approved }));
  return { nodes, edges };
}
