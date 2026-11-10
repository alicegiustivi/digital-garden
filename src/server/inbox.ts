// The Daily Inbox and phone intake on the Mac (issue #37, decided in #15).
// The phone's Telegram bot (a later build) saves each message as ONE FOLDER in a Google Drive folder that syncs to this Mac:
// the photos, plus a description file `capture.json` written LAST. The Garden takes a folder only once that file exists,
// makes the Objects, remembers the message id (so a message that arrives twice is kept once) and deletes the folder.
//   capture.json = { messageId, sentAt, private?, text?, links?, tags?, forward?: { text, author, url? }, files?: [{ name, kind? }] }
// What a message becomes:  words only -> a Thought · a link -> a Source · a photo -> an image Source · a forward -> a Source of
// format "post" · an album or several links -> one Source each. The owner's words beside Sources are a *comment*: they stay in
// the Daily Inbox (Owner Origin) until the owner turns them into a Thought. `#private` anywhere makes the whole capture Private
// and is removed; other hashtags become Owner Tags. A capture belongs to the day it was sent, by the Mac's clock.
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { homedir } from "node:os";
import type Database from "better-sqlite3";
import { BadRequest, getObject, summarise, tagIdFor, titleOf, cleanTagName } from "./objects.ts";
import { addBody, field, newObject } from "./capture.ts";
import { canonicalLink, URL_RE } from "./links.ts";
import { shrinkImage } from "./images.ts";
import { imagesDir, inboxSettingPath } from "./paths.ts";

type Db = Database.Database;
export type InboxDeps = {
  readLink: (id: string, url: string) => void;
  /** Newly captured Objects for the Archivist (it skips Private ones). */
  enqueue: (ids: string[]) => void;
};

export const DESCRIPTION_FILE = "capture.json";
/** The bot keeps this file's date fresh every day it runs; the Garden warns when it is more than a day old. */
export const HEARTBEAT_FILE = "heartbeat.txt";
const MAX_BYTES = 20 * 1024 * 1024; // Telegram's limit for bots
const PHOTO = new Set([".jpg", ".jpeg", ".png", ".heic", ".heif", ".gif", ".webp", ".tif", ".tiff"]);
const DAY_MS = 864e5;
/** A description or photo that appeared this recently may still be syncing: wait before calling it unreadable. */
const SETTLE_MS = 90_000;

// ---------------------------------------------------------------- the folder

export function inboxDir(): string | null {
  const env = process.env.GARDEN_INBOX_DIR?.trim();
  if (env) return env;
  try {
    const saved = readFileSync(inboxSettingPath(), "utf8").trim();
    return saved || null;
  } catch { return null; }
}
export function setInboxDir(path: unknown) {
  if (typeof path !== "string" || !path.trim()) throw new BadRequest("Choose the folder Google Drive puts your phone captures in");
  const p = path.trim().replace(/^~(?=\/|$)/, homedir());
  if (!existsSync(p)) throw new BadRequest("That folder isn't on this Mac. Check the path, or that Google Drive is running.");
  writeFileSync(inboxSettingPath(), p);
  return p;
}

const sqlTime = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19);
const isoOf = (s: string) => s.replace(" ", "T") + "Z";
/** The day by the Mac's clock, midnight to midnight. */
export const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export async function inboxStatus(db: Db) {
  const folder = inboxDir();
  const days = (db.prepare("SELECT day, count(*) AS n, sum(status = 'failed') AS failed FROM inbox_captures GROUP BY day ORDER BY day DESC").all() as any[]).map((d) => ({ day: d.day as string, count: d.n as number, failed: d.failed as number }));
  let warning: null | { kind: "unset" | "missing" | "stale"; text: string } = null;
  let lastSync: string | null = null;
  let waiting = 0;
  if (!folder) warning = { kind: "unset", text: "The Garden doesn't know where your phone captures arrive yet. Choose the Google Drive folder below." };
  else if (!existsSync(folder)) warning = { kind: "missing", text: `The Drive inbox folder is missing: ${folder}. Is Google Drive running on this Mac?` };
  else {
    try { lastSync = (await stat(join(folder, HEARTBEAT_FILE))).mtime.toISOString(); } catch {}
    if (lastSync && Date.now() - new Date(lastSync).getTime() > DAY_MS) warning = { kind: "stale", text: "The Drive inbox hasn't synced in over a day. Check that Google Drive is running and signed in; anything you sent is safe in Telegram." };
    for (const e of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      if (existsSync(join(folder, e.name, DESCRIPTION_FILE)) && !db.prepare("SELECT 1 FROM inbox_captures WHERE folder = ? AND status = 'failed'").get(e.name)) waiting++;
    }
  }
  return { folder, warning, lastSync, waiting, days };
}

// ---------------------------------------------------------------- reading the words

const TAG = /(^|\s)#([\p{L}\p{N}_-]+)/gu;
const TRAILING = /(?:(?:^|\s)#[\p{L}\p{N}_-]+)+\s*$/u;
/**
 * `#private` anywhere (any case) makes the whole capture Private and is removed. Every other hashtag is a Tag; hashtags that
 * end the text are removed from it, hashtags inside a sentence stay (and still become Tags).
 */
export function readWords(raw: string, extraTags: string[] = []) {
  let priv = false;
  let text = raw.replace(TAG, (m, pre: string, name: string) => (name.toLowerCase() === "private" ? ((priv = true), pre) : m));
  text = text.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  const tags: string[] = [];
  for (const m of text.matchAll(TAG)) tags.push(m[2]);
  text = text.replace(TRAILING, "").trim();
  const all = [...new Set([...tags, ...extraTags].map((t) => cleanTagName(t)).filter(Boolean))];
  return { text, tags: all, private: priv };
}

// ---------------------------------------------------------------- one capture folder

type Outcome = "done" | "duplicate" | "failed" | "waiting" | "none";

function remember(db: Db, row: { key: string; messageId: string | null; folder: string; sentAt: string; status: "done" | "failed"; reason: string | null; refused: boolean; comment: string | null; priv: boolean }) {
  // A failed folder first remembered by its name is now known by its message id: it is the same row.
  if (row.messageId) db.prepare("DELETE FROM inbox_captures WHERE key = ? AND status = 'failed'").run(`folder:${row.folder}`);
  db.prepare(
    `INSERT INTO inbox_captures (key, message_id, folder, sent_at, day, status, reason, refused, comment, private) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET status = excluded.status, reason = excluded.reason, refused = excluded.refused, folder = excluded.folder,
       comment = excluded.comment, private = excluded.private, sent_at = excluded.sent_at, day = excluded.day`,
  ).run(row.key, row.messageId, row.folder, sqlTime(row.sentAt), localDay(new Date(row.sentAt)), row.status, row.reason, row.refused ? 1 : 0, row.comment, row.priv ? 1 : 0);
  return (db.prepare("SELECT id FROM inbox_captures WHERE key = ?").get(row.key) as any).id as number;
}

/** Take one folder. `force` is the owner's Retry: it looks again even though the folder failed before. */
export async function takeFolder(db: Db, dir: string, name: string, deps: InboxDeps, force = false): Promise<{ outcome: Outcome; reason?: string }> {
  const path = join(dir, name);
  const descPath = join(path, DESCRIPTION_FILE);
  if (!existsSync(descPath)) return { outcome: "none" }; // not finished arriving: never read half a capture
  if (!force && db.prepare("SELECT 1 FROM inbox_captures WHERE folder = ? AND status = 'failed'").get(name)) return { outcome: "failed" };
  const descStat = await stat(descPath);
  const young = Date.now() - descStat.mtimeMs < SETTLE_MS && !force;
  const folderSent = descStat.mtime.toISOString();

  const fail = (reason: string, sentAt = folderSent, extra: { key?: string; messageId?: string | null; comment?: string | null; priv?: boolean; refused?: boolean } = {}) => {
    remember(db, { key: extra.key ?? `folder:${name}`, messageId: extra.messageId ?? null, folder: name, sentAt, status: "failed", reason, refused: !!extra.refused, comment: extra.comment ?? null, priv: !!extra.priv });
    return { outcome: "failed" as const, reason };
  };

  let d: any;
  try { d = JSON.parse(await readFile(descPath, "utf8")); if (!d || typeof d !== "object") throw new Error(); }
  catch { return young ? { outcome: "waiting" } : fail("The description file couldn't be read."); }

  const messageId = d.messageId !== undefined && d.messageId !== null ? String(d.messageId) : "";
  if (!messageId) return fail("The description file has no message id.");
  const key = `tg:${messageId}`;
  const sentRaw = typeof d.sentAt === "string" || typeof d.sentAt === "number" ? new Date(typeof d.sentAt === "number" ? d.sentAt * 1000 : d.sentAt) : null;
  const sentAt = sentRaw && !isNaN(sentRaw.getTime()) ? sentRaw.toISOString() : null;
  if (!sentAt) return fail("The description file has no readable send time.", folderSent, { key, messageId });

  // The same message arriving twice is kept once: the second folder is just deleted.
  if (db.prepare("SELECT 1 FROM inbox_captures WHERE key = ? AND status = 'done'").get(key)) {
    await rm(path, { recursive: true, force: true });
    return { outcome: "duplicate" };
  }

  const words = readWords(typeof d.text === "string" ? d.text : "", Array.isArray(d.tags) ? d.tags.filter((t: unknown) => typeof t === "string") : []);
  const priv = words.private || d.private === true;
  const ctx = { key, messageId, comment: words.text || null, priv };

  // Refused: voice notes, PDFs and other documents, videos, anything over 20 MB. Nothing is saved; the folder stays.
  const listed: { name: string; kind?: string }[] = Array.isArray(d.files) ? d.files.filter((f: any) => f && typeof f.name === "string").map((f: any) => ({ name: String(f.name).replace(/^.*[\\/]/, ""), kind: typeof f.kind === "string" ? f.kind : undefined })) : [];
  const photos: { name: string; bytes: Buffer }[] = [];
  for (const f of listed) {
    const ext = extname(f.name).toLowerCase();
    const label = f.kind === "voice" || /^\.(ogg|oga|opus|m4a|mp3|wav)$/.test(ext) ? "voice notes" : ext === ".pdf" || f.kind === "document" ? "PDFs and other documents" : f.kind === "video" || /^\.(mp4|mov|m4v|webm)$/.test(ext) ? "videos" : !PHOTO.has(ext) ? "that kind of file" : null;
    if (label) return fail(`Refused: the Garden doesn't keep ${label} yet. Nothing was saved.`, sentAt, { ...ctx, refused: true });
    let info;
    try { info = await stat(join(path, f.name)); } catch { return young ? { outcome: "waiting" } : fail(`The photo “${f.name}” is missing from the folder.`, sentAt, ctx); }
    if (info.size > MAX_BYTES) return fail("Refused: files over 20 MB aren't kept. Nothing was saved.", sentAt, { ...ctx, refused: true });
    photos.push({ name: f.name, bytes: await readFile(join(path, f.name)) });
  }

  // Links: the description lists them; links sitting in the words are taken as well.
  const rawLinks: string[] = Array.isArray(d.links) ? d.links.filter((l: unknown) => typeof l === "string") : [];
  let comment = words.text;
  if (!Array.isArray(d.links)) {
    for (const m of comment.match(URL_RE) ?? []) rawLinks.push(m);
    comment = comment.replace(URL_RE, " ").replace(/[ \t]{2,}/g, " ").replace(/[ \t]*\n[ \t]*/g, "\n").trim();
  }
  const links: string[] = [];
  for (const raw of rawLinks) { const c = canonicalLink(raw); if (c && !links.includes(c)) links.push(c); }
  const fwd = d.forward && typeof d.forward === "object" && typeof d.forward.text === "string" && d.forward.text.trim() ? d.forward : null;
  if (!comment && !links.length && !photos.length && !fwd) return fail("There was nothing in it to keep.", sentAt, ctx);
  ctx.comment = (links.length || photos.length || fwd) && comment ? comment : null;

  // Shrink pictures first: if one can't be read, nothing is saved and the folder stays for Retry.
  const shrunk: { id: string; name: string; width: number | null; height: number | null }[] = [];
  try {
    for (const p of photos) {
      const id = randomUUID();
      const info = await shrinkImage(id, p.name, p.bytes);
      shrunk.push({ id, name: p.name, width: info.width, height: info.height });
    }
  } catch (e: any) {
    await Promise.all(shrunk.flatMap((s) => [rm(join(imagesDir(), `${s.id}.jpg`), { force: true }), rm(join(imagesDir(), `${s.id}.thumb.jpg`), { force: true })]));
    return fail(`${e.message ?? "A photo couldn't be read"}.`.replace(/\.\.$/, "."), sentAt, ctx);
  }

  const created = sqlTime(sentAt);
  const made: string[] = []; // new Objects, for the Archivist
  const shown: string[] = []; // everything the card list shows, in order
  const toRead: { id: string; url: string }[] = [];
  let captureId = 0;
  db.transaction(() => {
    const born = (id: string) => db.prepare("UPDATE objects SET created_at = ?, updated_at = ? WHERE id = ?").run(created, created, id);
    const tag = (id: string) => {
      const ins = db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin) VALUES (?, ?, 'owner')");
      for (const t of words.tags) ins.run(id, tagIdFor(db, t));
    };
    for (const url of links) {
      const dupe = db.prepare(`SELECT o.id FROM field_values f JOIN objects o ON o.id = f.object_id WHERE f.field = 'link' AND f.value = ? AND o.type = 'source' AND o.deleted_at IS NULL`).get(url) as any;
      if (dupe) { shown.push(dupe.id); continue; }
      const id = newObject(db, "source", priv);
      born(id); field(db, id, "link", url); field(db, id, "format", "web page"); field(db, id, "extraction", "reading"); tag(id);
      made.push(id); shown.push(id); toRead.push({ id, url });
    }
    for (const s of shrunk) {
      db.prepare("INSERT INTO objects (id, type, private, unreviewed, captured, created_at, updated_at) VALUES (?, 'source', ?, 1, 1, ?, ?)").run(s.id, priv ? 1 : 0, created, created);
      const title = s.name.replace(/\.[a-z0-9]{1,5}$/i, "") || "Image";
      field(db, s.id, "title", title);
      db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(title, s.id);
      field(db, s.id, "format", "image");
      db.prepare("INSERT INTO source_images (object_id, file, thumb, width, height) VALUES (?, ?, ?, ?, ?)").run(s.id, `${s.id}.jpg`, `${s.id}.thumb.jpg`, s.width, s.height);
      tag(s.id); made.push(s.id); shown.push(s.id);
    }
    if (fwd) {
      // A forward is captured content (Source Origin); its author is a name, not a Person.
      const id = newObject(db, "source", priv);
      born(id);
      const author = typeof fwd.author === "string" ? fwd.author.trim() : "";
      const title = author ? `Post by ${author}` : "Forwarded post";
      field(db, id, "title", title);
      db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(title, id);
      field(db, id, "format", "post");
      field(db, id, "captured", String(fwd.text).trim());
      if (author) field(db, id, "authors", author);
      const url = typeof fwd.url === "string" ? canonicalLink(fwd.url) : null;
      if (url) field(db, id, "link", url);
      tag(id); made.push(id); shown.push(id);
    }
    if (!links.length && !shrunk.length && !fwd) {
      // Words only: a Thought. Its words live in the Thought; the inbox shows its card.
      const id = newObject(db, "thought", priv);
      born(id); addBody(db, id, comment); tag(id);
      made.push(id); shown.push(id);
    }
    captureId = remember(db, { key, messageId, folder: name, sentAt, status: "done", reason: null, refused: false, comment: ctx.comment, priv });
    db.prepare("DELETE FROM inbox_objects WHERE capture_id = ?").run(captureId);
    shown.forEach((id, i) => db.prepare("INSERT OR IGNORE INTO inbox_objects (capture_id, object_id, position) VALUES (?, ?, ?)").run(captureId, id, i));
  })();

  for (const r of toRead) deps.readLink(r.id, r.url);
  deps.enqueue(made);
  // The Objects are in the Garden: now the folder can go.
  await rm(path, { recursive: true, force: true });
  return { outcome: "done" };
}

let scanning: Promise<unknown> | null = null;
/** Look through the Drive inbox once and take every capture that has fully arrived. */
export function scanInbox(db: Db, deps: InboxDeps): Promise<{ taken: number; failed: number }> {
  const run = async () => {
    const dir = inboxDir();
    const result = { taken: 0, failed: 0 };
    if (!dir) return result;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      try {
        // A file still downloading from Drive looks unreadable or missing for a while: look again on every check instead of giving up.
        const syncing = !!db.prepare("SELECT 1 FROM inbox_captures WHERE folder = ? AND status = 'failed' AND (reason LIKE 'The description file couldn''t be read%' OR reason LIKE '%is missing from the folder%')").get(e.name);
        const r = await takeFolder(db, dir, e.name, deps, syncing);
        if (r.outcome === "done") result.taken++;
        if (r.outcome === "failed" && r.reason) result.failed++;
      } catch (err) { console.error("Daily Inbox: couldn't take", e.name, err); }
    }
    return result;
  };
  // One scan at a time: a second request waits for the first and shares its answer.
  scanning ??= run().finally(() => { scanning = null; });
  return scanning as Promise<{ taken: number; failed: number }>;
}

// ---------------------------------------------------------------- reading the inbox

type Row = { id: number; folder: string; sent_at: string; day: string; status: string; reason: string | null; refused: number; comment: string | null; private: number; thought_id: string | null };

export function dayPage(db: Db, day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new BadRequest("That isn't a day");
  const rows = db.prepare("SELECT * FROM inbox_captures WHERE day = ? ORDER BY sent_at, id").all(day) as Row[];
  const entries = rows.map((r) => {
    const objs = db.prepare("SELECT o.* FROM inbox_objects io JOIN objects o ON o.id = io.object_id WHERE io.capture_id = ? AND o.deleted_at IS NULL ORDER BY io.position").all(r.id);
    return {
      id: r.id,
      at: isoOf(r.sent_at),
      status: r.status as "done" | "failed",
      reason: r.reason,
      refused: !!r.refused,
      private: !!r.private,
      comment: r.thought_id ? null : r.comment,
      thought: r.thought_id ? (() => { const t = getObject(db, r.thought_id!); return t ? { id: t.id, title: titleOf(db, t.id) } : null; })() : null,
      objects: summarise(db, objs),
    };
  });
  return { day, entries };
}

/** For the Unreviewed list: which of these Objects arrived through the Daily Inbox, and on which day. */
export function daysOf(db: Db, ids: string[]) {
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT io.object_id, c.day FROM inbox_objects io JOIN inbox_captures c ON c.id = io.capture_id WHERE io.object_id IN (${ids.map(() => "?").join(",")}) ORDER BY c.sent_at`).all(...ids) as any[];
  for (const r of rows) out[r.object_id] = r.day;
  return out;
}

/** The owner's comment as it shows on a Source: the same text as in the inbox. Gone once it has become a Thought. */
export function commentOn(db: Db, objectId: string) {
  const r = db.prepare(
    `SELECT c.id, c.day, c.comment, c.sent_at FROM inbox_objects io JOIN inbox_captures c ON c.id = io.capture_id
     WHERE io.object_id = ? AND c.status = 'done' AND c.comment IS NOT NULL AND c.thought_id IS NULL ORDER BY c.sent_at DESC LIMIT 1`,
  ).get(objectId) as any;
  return r ? { captureId: r.id as number, day: r.day as string, at: isoOf(r.sent_at), comment: r.comment as string } : null;
}

export function editComment(db: Db, captureId: number, comment: unknown) {
  const c = db.prepare("SELECT * FROM inbox_captures WHERE id = ?").get(captureId) as Row | undefined;
  if (!c) return null;
  if (c.thought_id) throw new BadRequest("This comment is a Thought now. Edit the Thought instead.");
  if (typeof comment !== "string") throw new BadRequest("A comment is words");
  db.prepare("UPDATE inbox_captures SET comment = ? WHERE id = ?").run(comment.trim() || null, captureId);
  return { comment: comment.trim() || null };
}

/** Turn a comment into a Thought in the owner's words, connected (related) to each Source it was sent with. */
export function commentToThought(db: Db, captureId: number) {
  const c = db.prepare("SELECT * FROM inbox_captures WHERE id = ?").get(captureId) as Row | undefined;
  if (!c || c.status !== "done") return null;
  if (c.thought_id || !c.comment) throw new BadRequest("There is no comment to turn into a Thought");
  const id = randomUUID();
  db.transaction(() => {
    // Made on purpose, so never Unreviewed; dated the day the message was sent.
    db.prepare("INSERT INTO objects (id, type, private, unreviewed, captured, created_at, updated_at) VALUES (?, 'thought', ?, 0, 0, ?, ?)").run(id, c.private, c.sent_at, c.sent_at);
    addBody(db, id, c.comment!);
    const sources = db.prepare("SELECT o.id FROM inbox_objects io JOIN objects o ON o.id = io.object_id WHERE io.capture_id = ? AND o.type = 'source' AND o.deleted_at IS NULL ORDER BY io.position").all(captureId) as any[];
    const ins = db.prepare("INSERT OR IGNORE INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'related', 'owner')");
    for (const s of sources) ins.run(id, s.id);
    db.prepare("UPDATE inbox_captures SET thought_id = ? WHERE id = ?").run(id, captureId);
  })();
  return id;
}

export function folderOf(db: Db, captureId: number) {
  const c = db.prepare("SELECT folder, status FROM inbox_captures WHERE id = ?").get(captureId) as any;
  const dir = inboxDir();
  if (!c || c.status !== "failed" || !dir) return null;
  return { dir, name: c.folder as string, path: join(dir, c.folder as string) };
}

export const revealInFinder = (path: string) => { execFile("open", ["-R", path], () => {}); };
