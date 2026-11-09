// A Person's Portrait (issue #69): one photo the owner adds, shrunk and kept like other pictures.
// Replacing or removing keeps the previous files until the next change, so Undo can bring them back.
// Nothing here is ever read by an AI role: the Portrait is not a field and not a source image.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
type Db = Database.Database;
import { BadRequest } from "./objects.ts";
import { shrinkImage } from "./images.ts";
import { imagesDir } from "./paths.ts";

export type PortraitState = { stem: string; width: number | null; height: number | null } | null;
const UUID = /^[0-9a-f-]{36}$/;
export const STEM = /^portrait-[0-9a-f-]{36}-[a-z0-9]{1,16}$/;

const person = (db: Db, id: string) => {
  const o = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any;
  if (!o) return false;
  if (o.type !== "person") throw new BadRequest("Only a Person has a Portrait");
  return true;
};
export const portraitOf = (db: Db, id: string): PortraitState => {
  const r = db.prepare("SELECT stem, width, height FROM person_portraits WHERE object_id = ?").get(id) as any;
  return r ? { stem: r.stem, width: r.width, height: r.height } : null;
};
const put = (db: Db, id: string, p: PortraitState) => {
  if (p) db.prepare("INSERT INTO person_portraits (object_id, stem, width, height) VALUES (?,?,?,?) ON CONFLICT(object_id) DO UPDATE SET stem = excluded.stem, width = excluded.width, height = excluded.height").run(id, p.stem, p.width, p.height);
  else db.prepare("DELETE FROM person_portraits WHERE object_id = ?").run(id);
  db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
};

/** Delete this Person's Portrait files except the ones named (the current one and the one Undo may need). */
async function tidy(id: string, keep: (string | undefined)[]) {
  const names = await readdir(imagesDir()).catch(() => [] as string[]);
  const wanted = new Set(keep.filter(Boolean).flatMap((s) => [`${s}.jpg`, `${s}.thumb.jpg`]));
  for (const n of names) if (n.startsWith(`portrait-${id}-`) && !wanted.has(n)) await rm(join(imagesDir(), n), { force: true }).catch(() => {});
}

/** Put a new Portrait in. Answers with what it replaced, so the page can offer Undo. */
export async function setPortrait(db: Db, id: string, name: string, bytes: Buffer) {
  if (!person(db, id)) return null;
  if (!bytes.length) throw new BadRequest("That file is empty");
  const stem = `portrait-${id}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const info = await shrinkImage(stem, name, bytes).catch((e) => { throw new BadRequest(e.message); });
  const previous = portraitOf(db, id);
  put(db, id, { stem, width: info.width, height: info.height });
  await tidy(id, [stem, previous?.stem]);
  return { portrait: portraitOf(db, id), previous };
}

export async function removePortrait(db: Db, id: string) {
  if (!person(db, id)) return null;
  const previous = portraitOf(db, id);
  put(db, id, null);
  await tidy(id, [previous?.stem]);
  return { portrait: null, previous };
}

/** Undo: set the Portrait back to the one named (or to none). Only files this Person's Portrait made earlier can come back. */
export async function restorePortrait(db: Db, id: string, back: any) {
  if (!person(db, id)) return null;
  const current = portraitOf(db, id);
  const stem = back && typeof back === "object" ? back.stem : back;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  if (stem === null || stem === undefined) { put(db, id, null); await tidy(id, [current?.stem]); return { portrait: null, previous: current }; }
  if (typeof stem !== "string" || !STEM.test(stem) || !stem.startsWith(`portrait-${id}-`)) throw new BadRequest("That is not one of this Person's Portraits");
  const names = new Set(await readdir(imagesDir()).catch(() => [] as string[]));
  if (!names.has(`${stem}.jpg`) || !names.has(`${stem}.thumb.jpg`)) throw new BadRequest("That Portrait is no longer kept");
  put(db, id, { stem, width: num(back?.width), height: num(back?.height) });
  await tidy(id, [stem, current?.stem]);
  return { portrait: portraitOf(db, id), previous: current };
}

/** Files for a Portrait stem, for serving. */
export const portraitFile = (stem: string, thumb: boolean) => (STEM.test(stem) ? join(imagesDir(), `${stem}${thumb ? ".thumb" : ""}.jpg`) : null);

/** Remove every Portrait file an Object ever made (when it leaves the Bin for good). */
export async function dropPortraitFiles(db: Db, id: string) {
  if (!UUID.test(id)) return;
  // a Portrait moved to another Person by a merge keeps its file name, so spare any file a row still names
  await tidy(id, (db.prepare("SELECT stem FROM person_portraits").all() as any[]).map((r) => r.stem));
}
