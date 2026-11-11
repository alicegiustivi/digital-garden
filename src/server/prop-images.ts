// A picture the owner adds to an "image" property of a type of their own (a book cover, a photo), issue #107 follow-up, ADR 0010.
// The same idea as a Person's Portrait (portraits.ts): one picture per property, shrunk and kept like other pictures, and replacing or
// removing keeps the previous files until the next change so Undo can bring them back. It is not a field value (so it is not searched or
// exported as text) and nothing here is ever read by an AI role: the Archivist never fills it and no picture is ever sent to a model.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { BadRequest } from "./objects.ts";
import { shrinkImage } from "./images.ts";
import { imagesDir } from "./paths.ts";

type Db = Database.Database;
export type PropImage = { stem: string; width: number | null; height: number | null } | null;
const UUID = /^[0-9a-f-]{36}$/;
const FIELD = /^c-[0-9a-f]{10}$/;
export const PIMG_STEM = /^pimg-[0-9a-f-]{36}-c-[0-9a-f]{10}-[a-z0-9]{1,16}$/;

/** The property must be an image property of this live Object's type. */
function target(db: Db, id: string, field: string): boolean {
  const o = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any;
  if (!o) return false;
  const f = db.prepare("SELECT fd.kind FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? AND tf.field = ?").get(o.type, field) as any;
  if (!FIELD.test(field) || f?.kind !== "image") throw new BadRequest("That is not a picture property of this Object");
  return true;
}
export const imageOf = (db: Db, id: string, field: string): PropImage => {
  const r = db.prepare("SELECT stem, width, height FROM property_images WHERE object_id = ? AND field = ?").get(id, field) as any;
  return r ? { stem: r.stem, width: r.width, height: r.height } : null;
};
const put = (db: Db, id: string, field: string, p: PropImage) => {
  if (p) db.prepare("INSERT INTO property_images (object_id, field, stem, width, height) VALUES (?,?,?,?,?) ON CONFLICT(object_id, field) DO UPDATE SET stem = excluded.stem, width = excluded.width, height = excluded.height").run(id, field, p.stem, p.width, p.height);
  else db.prepare("DELETE FROM property_images WHERE object_id = ? AND field = ?").run(id, field);
  db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
};

/** Delete this property's picture files except the ones named (the current one and the one Undo may need). */
async function tidy(id: string, field: string, keep: (string | undefined)[]) {
  const names = await readdir(imagesDir()).catch(() => [] as string[]);
  const wanted = new Set(keep.filter(Boolean).flatMap((s) => [`${s}.jpg`, `${s}.thumb.jpg`]));
  for (const n of names) if (n.startsWith(`pimg-${id}-${field}-`) && !wanted.has(n)) await rm(join(imagesDir(), n), { force: true }).catch(() => {});
}

export async function setPropImage(db: Db, id: string, field: string, name: string, bytes: Buffer) {
  if (!target(db, id, field)) return null;
  if (!bytes.length) throw new BadRequest("That file is empty");
  const stem = `pimg-${id}-${field}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const info = await shrinkImage(stem, name, bytes).catch((e) => { throw new BadRequest(e.message); });
  const previous = imageOf(db, id, field);
  put(db, id, field, { stem, width: info.width, height: info.height });
  await tidy(id, field, [stem, previous?.stem]);
  return { image: imageOf(db, id, field), previous };
}

export async function removePropImage(db: Db, id: string, field: string) {
  if (!target(db, id, field)) return null;
  const previous = imageOf(db, id, field);
  put(db, id, field, null);
  await tidy(id, field, [previous?.stem]);
  return { image: null, previous };
}

/** Undo: set the picture back to the one named (or to none). Only files this property made earlier can come back. */
export async function restorePropImage(db: Db, id: string, field: string, back: any) {
  if (!target(db, id, field)) return null;
  const current = imageOf(db, id, field);
  const stem = back && typeof back === "object" ? back.stem : back;
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  if (stem === null || stem === undefined) { put(db, id, field, null); await tidy(id, field, [current?.stem]); return { image: null, previous: current }; }
  if (typeof stem !== "string" || !PIMG_STEM.test(stem) || !stem.startsWith(`pimg-${id}-${field}-`)) throw new BadRequest("That is not one of this property's pictures");
  const names = new Set(await readdir(imagesDir()).catch(() => [] as string[]));
  if (!names.has(`${stem}.jpg`) || !names.has(`${stem}.thumb.jpg`)) throw new BadRequest("That picture is no longer kept");
  put(db, id, field, { stem, width: num(back?.width), height: num(back?.height) });
  await tidy(id, field, [stem, current?.stem]);
  return { image: imageOf(db, id, field), previous: current };
}

/** Files for a picture stem, for serving. */
export const propImageFile = (stem: string, thumb: boolean) => (PIMG_STEM.test(stem) ? join(imagesDir(), `${stem}${thumb ? ".thumb" : ""}.jpg`) : null);

/** Remove every property-picture file an Object ever made (when it leaves the Bin for good), sparing any a row still names. */
export async function dropPropImageFiles(db: Db, id: string) {
  if (!UUID.test(id)) return;
  const still = new Set((db.prepare("SELECT stem FROM property_images").all() as any[]).flatMap((r) => [`${r.stem}.jpg`, `${r.stem}.thumb.jpg`]));
  const names = await readdir(imagesDir()).catch(() => [] as string[]);
  for (const n of names) if (n.startsWith(`pimg-${id}-`) && !still.has(n)) await rm(join(imagesDir(), n), { force: true }).catch(() => {});
}
