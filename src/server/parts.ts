// "Part of" (issue #140; CONTEXT.md: Piece, Project, Connection Kind): a Piece belongs to at most one Project, and a Project
// keeps its Pieces in an order the owner drags (its outline). The order lives only on the "part of" Connection, so a standalone Piece has none.
import type Database from "better-sqlite3";
import { BadRequest, titleOf } from "./objects.ts";
import { STAGES } from "../shared/palette.ts";

type Db = Database.Database;

export const PART_OF = "part of";
const typeOf = (db: Db, id: string): string | undefined => (db.prepare("SELECT type FROM objects WHERE id = ?").get(id) as any)?.type;
const isLive = (db: Db, id: string) => !!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);

/** Which of the two Objects is the Piece and which the Project. A "part of" only ever joins a Piece to a Project. */
export function partEnds(db: Db, a: string, b: string): { piece: string; project: string } {
  const [ta, tb] = [typeOf(db, a), typeOf(db, b)];
  if (ta === "piece" && tb === "project") return { piece: a, project: b };
  if (ta === "project" && tb === "piece") return { piece: b, project: a };
  throw new BadRequest("“part of” joins a Piece to a Project. Pick a Piece and a Project.");
}

/** The live Project this Piece is part of, with the Connection that says so (ignoring one Connection, e.g. the one being changed). */
export function projectOf(db: Db, pieceId: string, ignore?: number) {
  return db
    .prepare(
      `SELECT c.id AS connId, o.id AS projectId FROM connections c JOIN objects o ON o.id = c.to_id AND o.deleted_at IS NULL
       WHERE c.kind = 'part of' AND c.from_id = ? AND c.id <> ?`,
    )
    .get(pieceId, ignore ?? -1) as { connId: number; projectId: string } | undefined;
}

/** Put a Piece in a Project. If it already belongs to another one, refuse with a clear message — or, when the owner chose to move it, take it out of the old one. */
export function checkOnePlace(db: Db, pieceId: string, projectId: string, opts: { move?: boolean; ignore?: number } = {}) {
  const there = projectOf(db, pieceId, opts.ignore);
  if (!there) return;
  if (opts.move) { db.prepare("DELETE FROM connections WHERE id = ?").run(there.connId); renumber(db, there.projectId); return; }
  const name = titleOf(db, there.projectId);
  const e = new BadRequest(`This Piece is already part of “${name}”. A Piece belongs to one Project at most: take it out of that one first, or move it here.`);
  (e as any).extra = { partOf: { id: there.projectId, title: name }, move: { piece: pieceId, project: projectId } };
  throw e;
}

/** The next place at the end of a Project's outline. */
export const endOfOutline = (db: Db, projectId: string): number =>
  ((db.prepare("SELECT coalesce(max(position), -1) AS m FROM connections WHERE kind = 'part of' AND to_id = ?").get(projectId) as any).m as number) + 1;

/** Number a Project's Pieces 0, 1, 2… in their current order (after one leaves, joins or is merged). */
export function renumber(db: Db, projectId: string) {
  const rows = db.prepare("SELECT id FROM connections WHERE kind = 'part of' AND to_id = ? ORDER BY coalesce(position, 1e9), id").all(projectId) as any[];
  const set = db.prepare("UPDATE connections SET position = ? WHERE id = ?");
  rows.forEach((r, i) => set.run(i, r.id));
}

const stageOf = (db: Db, id: string, type: string) =>
  ((db.prepare("SELECT value FROM field_values WHERE object_id = ? AND field = ?").get(id, STAGES[type].field) as any)?.value as string | undefined) ?? STAGES[type].first;

const brief = (db: Db, id: string, type: "piece" | "project") => {
  const o = db.prepare("SELECT private FROM objects WHERE id = ?").get(id) as any;
  return { id, type, title: titleOf(db, id), stage: stageOf(db, id, type), private: !!o.private };
};

/** A Project's Pieces in the owner's order. Each carries its own Stage; the page groups by it. */
export function piecesOf(db: Db, projectId: string) {
  if (typeOf(db, projectId) !== "project" || !isLive(db, projectId)) return null;
  const rows = db
    .prepare(
      `SELECT c.id AS connId, c.from_id AS id FROM connections c JOIN objects o ON o.id = c.from_id AND o.deleted_at IS NULL
       WHERE c.kind = 'part of' AND c.to_id = ? ORDER BY coalesce(c.position, 1e9), c.id`,
    )
    .all(projectId) as any[];
  return { project: brief(db, projectId, "project"), pieces: rows.map((r) => ({ connectionId: r.connId as number, ...brief(db, r.id, "piece") })) };
}

/** The Project a Piece belongs to, or null when it stands alone. */
export function projectOfPiece(db: Db, pieceId: string) {
  if (typeOf(db, pieceId) !== "piece" || !isLive(db, pieceId)) return undefined;
  const p = projectOf(db, pieceId);
  return { project: p ? { ...brief(db, p.projectId, "project"), connectionId: p.connId } : null };
}

/** The owner drags: save the order of all the Pieces of one Project. */
export function setOutline(db: Db, projectId: string, order: unknown) {
  const now = piecesOf(db, projectId);
  if (!now) return null;
  if (!Array.isArray(order) || order.some((x) => typeof x !== "string")) throw new BadRequest("order must be a list of Piece ids");
  const have = new Set(now.pieces.map((p) => p.id));
  if (order.length !== have.size || new Set(order).size !== have.size || order.some((x) => !have.has(x)))
    throw new BadRequest("This Project's Pieces changed. Reload the page and try again.");
  db.transaction(() => {
    const set = db.prepare("UPDATE connections SET position = ? WHERE kind = 'part of' AND to_id = ? AND from_id = ?");
    (order as string[]).forEach((id, i) => set.run(i, projectId, id));
    renumber(db, projectId); // keeps any Piece in the Bin after the rest
  })();
  return piecesOf(db, projectId);
}
