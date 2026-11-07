// Mac Capture (issues #21, #23, #27). One box in, Objects out:
//  - words only                    -> a Thought
//  - one link or image (+ words)   -> a Source, the words as its body
//  - several links/images (+ words)-> one Source each, and a Thought with the words that mentions them all
// Everything is stored as Unreviewed. The owner's words are Owner Origin; the link and anything read from the
// page or picture are Source Origin. A link already in the Garden is reused, never copied.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { BadRequest, getObject } from "./objects.ts";
import { shrinkImage } from "./images.ts";
import { mentionToken } from "./mentions.ts";
import { canonicalLink } from "./links.ts";
import { rm } from "node:fs/promises";
import { imagesDir } from "./paths.ts";
import { join } from "node:path";

type Db = Database.Database;
export type Upload = { name: string; bytes: Buffer };
export type CaptureInput = { text?: unknown; links?: unknown; private?: unknown; images?: Upload[] };

const field = (db: Db, id: string, key: string, value: string) =>
  db.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES (?, ?, ?, 'source')").run(id, key, value);

function paragraphsOf(text: string) {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
function addBody(db: Db, id: string, text: string) {
  const ins = db.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, ?, ?, 'owner')");
  paragraphsOf(text).forEach((p, i) => ins.run(id, i, p));
}
function newObject(db: Db, type: string, priv: boolean) {
  const id = randomUUID();
  db.prepare("INSERT INTO objects (id, type, private, unreviewed, captured, updated_at) VALUES (?, ?, ?, 1, 1, datetime('now'))").run(id, type, priv ? 1 : 0);
  return id;
}

export async function capture(db: Db, input: CaptureInput, readLater: (id: string, url: string) => void) {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const rawLinks = Array.isArray(input.links) ? input.links : [];
  const links: string[] = [];
  for (const raw of rawLinks) {
    const c = typeof raw === "string" ? canonicalLink(raw) : null;
    if (!c) throw new BadRequest("That doesn't look like a web link");
    if (!links.includes(c)) links.push(c);
  }
  const images = input.images ?? [];
  const priv = input.private === true;
  if (!text && !links.length && !images.length) throw new BadRequest("There is nothing to save yet");

  // Shrink pictures first: if one can't be read nothing is saved, and the box keeps everything.
  const shrunk: { id: string; name: string; width: number | null; height: number | null }[] = [];
  try {
    for (const img of images) {
      const id = randomUUID();
      const info = await shrinkImage(id, img.name, img.bytes).catch((e) => { throw new BadRequest(e.message); });
      shrunk.push({ id, name: img.name, width: info.width, height: info.height });
    }
  } catch (e) {
    await Promise.all(shrunk.flatMap((s) => [rm(join(imagesDir(), `${s.id}.jpg`), { force: true }), rm(join(imagesDir(), `${s.id}.thumb.jpg`), { force: true })]));
    throw e;
  }

  const toRead: { id: string; url: string }[] = [];
  const sources: string[] = [];
  const existing: string[] = [];
  let thoughtId: string | null = null;
  const sourceCount = links.length + shrunk.length;

  db.transaction(() => {
    const body = (id: string) => { if (text && sourceCount === 1) addBody(db, id, text); };
    for (const url of links) {
      const dupe = db
        .prepare(`SELECT o.id FROM field_values f JOIN objects o ON o.id = f.object_id WHERE f.field = 'link' AND f.value = ? AND o.type = 'source' AND o.deleted_at IS NULL`)
        .get(url) as any;
      if (dupe) { existing.push(dupe.id); sources.push(dupe.id); continue; } // an existing Source keeps its own words
      const id = newObject(db, "source", priv);
      field(db, id, "link", url);
      field(db, id, "format", "web page");
      field(db, id, "extraction", "reading");
      body(id);
      sources.push(id);
      toRead.push({ id, url });
    }
    for (const s of shrunk) {
      const id = s.id;
      db.prepare("INSERT INTO objects (id, type, private, unreviewed, captured, updated_at) VALUES (?, 'source', ?, 1, 1, datetime('now'))").run(id, priv ? 1 : 0);
      const title = s.name.replace(/\.[a-z0-9]{1,5}$/i, "") || "Image";
      field(db, id, "title", title);
      db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(title, id);
      field(db, id, "format", "image");
      db.prepare("INSERT INTO source_images (object_id, file, thumb, width, height) VALUES (?, ?, ?, ?, ?)").run(id, `${id}.jpg`, `${id}.thumb.jpg`, s.width, s.height);
      body(id);
      sources.push(id);
    }
    if (sourceCount === 0) {
      thoughtId = newObject(db, "thought", priv);
      addBody(db, thoughtId, text);
    } else if (sourceCount > 1 && text) {
      thoughtId = newObject(db, "thought", priv);
      addBody(db, thoughtId, text);
      const ins = db.prepare("INSERT OR IGNORE INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'mentions', 'owner')");
      for (const s of sources) ins.run(thoughtId, s);
      // Each Source is a Mention on its own line in the Thought, so the body shows what the Connections say.
      const start = paragraphsOf(text).length;
      const body = db.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, ?, ?, 'owner')");
      sources.forEach((s, i) => body.run(thoughtId, start + i, mentionToken(s)));
    }
  })();

  for (const r of toRead) readLater(r.id, r.url);

  const created = [...sources.filter((id) => !existing.includes(id)), ...(thoughtId ? [thoughtId] : [])];
  return {
    created: created.map((id) => getObject(db, id)!),
    existing: existing.map((id) => getObject(db, id)!),
    thoughtId,
    // What "Open it" should open: the Thought if there is one, else the first Source.
    openId: thoughtId ?? sources[0],
  };
}
