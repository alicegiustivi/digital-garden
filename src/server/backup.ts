// Daily encrypted Backup to Google Drive (issue #39, decided in #9 and #21, ADR 0002).
// A Backup is the only way the Garden is put back (an Export is a different thing and is never used to restore).
//
// How it works, in plain terms:
//  - The Mac's Google Drive app keeps a folder in sync with Drive. The Garden writes already-encrypted files into that
//    folder, so no Google password, login or token is ever held by the Garden.
//  - Every file is encrypted here, on the Mac, with AES-256-GCM. The key comes from a password only the owner knows
//    (scrypt), remembered in the Mac's Keychain. Without the password the files in Drive are unreadable.
//  - The database is copied once a day (garden-<day>.db.enc); each image is copied once (images/<name>.enc);
//    a small list per day (manifest-<day>.json.enc) says which images belonged to that day.
//  - The last 4 weeks are kept. An image copy is kept for as long as any kept day lists it.
// The password is never written to a file, a log or an error message here.
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { BadRequest } from "./objects.ts";
import { gardenDir, imagesDir } from "./paths.ts";
import { localDay } from "./inbox.ts";

type Db = Database.Database;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const KEEP_DAYS = 28;
export const KEYCHAIN_SERVICE = "Digital Garden backup";
const MAGIC = Buffer.from("GBK1");
const KEY_FILE = "garden-backup.json";
const VERIFY_TEXT = "garden backup password check";
/** The Mac may be asleep at 03:00; the first check after this hour that finds no Backup today makes one. */
export const BACKUP_HOUR = 3;
const RETRY_AFTER_FAILURE_MS = 60 * 60_000;

export const backupSettingPath = () => join(gardenDir(), "backup-folder.txt");
export const backupStatePath = () => join(gardenDir(), "backup-state.json");

// ---------------------------------------------------------------- the folder and the password

export function backupDir(): string | null {
  const env = process.env.GARDEN_BACKUP_DIR?.trim();
  if (env) return env;
  try { return readFileSync(backupSettingPath(), "utf8").trim() || null; } catch { return null; }
}
export function setBackupDir(path: unknown) {
  if (typeof path !== "string" || !path.trim()) throw new BadRequest("Choose the Google Drive folder your Backups go in");
  const p = path.trim().replace(/^~(?=\/|$)/, homedir());
  if (!existsSync(p)) throw new BadRequest("That folder isn't on this Mac. Check the path, or that Google Drive is running.");
  writeFileSync(backupSettingPath(), p);
  const s = readState();
  if (!s.since) writeState({ ...s, since: new Date().toISOString() });
  return p;
}

/** Where the backup password comes from. In the Garden it is the Mac's Keychain; tests pass their own. */
export type PasswordSource = () => Promise<string | null>;
const run = promisify(execFile);
export const keychainPassword: PasswordSource = async () => {
  try {
    const { stdout } = await run("/usr/bin/security", ["find-generic-password", "-a", "garden", "-s", KEYCHAIN_SERVICE, "-w"], { timeout: 15_000 });
    return stdout.replace(/\r?\n$/, "") || null;
  } catch { return null; }
};

// ---------------------------------------------------------------- encryption

const keyFor = (password: string, salt: Buffer) => scrypt(password, salt, 32);

/** File format: "GBK1" · 12-byte random iv · ciphertext · 16-byte tag. The file's name is the associated data (not secret). */
async function encryptFile(key: Buffer, from: string, to: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const part = `${to}.part`;
  await mkdir(join(to, ".."), { recursive: true });
  const out = createWriteStream(part);
  out.write(Buffer.concat([MAGIC, iv]));
  const body = new Transform({ transform(chunk, _e, cb) { cb(null, c.update(chunk)); }, flush(cb) { try { c.final(); cb(null, c.getAuthTag()); } catch (e) { cb(e as Error); } } });
  await pipeline(createReadStream(from), body, out);
  await rename(part, to); // never leave a half-written file where Drive would upload it as complete
}
async function decryptFile(key: Buffer, from: string, to: string) {
  const size = (await stat(from)).size;
  if (size < MAGIC.length + 12 + 16) throw new Error("not a Garden backup file");
  const fd = await open(from, "r");
  let head: Buffer, tag: Buffer;
  try {
    head = Buffer.alloc(MAGIC.length + 12); await fd.read(head, 0, head.length, 0);
    tag = Buffer.alloc(16); await fd.read(tag, 0, 16, size - 16);
  } finally { await fd.close(); }
  if (!head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("not a Garden backup file");
  const d = createDecipheriv("aes-256-gcm", key, head.subarray(MAGIC.length));
  d.setAuthTag(tag);
  await mkdir(join(to, ".."), { recursive: true });
  await pipeline(createReadStream(from, { start: head.length, end: size - 17 }), d, createWriteStream(to));
}
async function encryptText(key: Buffer, text: string, to: string, work: string) {
  const f = join(work, "t.txt"); await writeFile(f, text); await encryptFile(key, f, to);
}
async function decryptText(key: Buffer, from: string, work: string) {
  const f = join(work, "t.out"); await decryptFile(key, from, f); return readFile(f, "utf8");
}

export class WrongPassword extends Error { constructor() { super("The backup password doesn't match the one these Backups were made with."); } }

/** The plain `garden-backup.json` holds only the salt and a check value, so a wrong password is caught before anything is written. */
async function openKey(folder: string, password: string, work: string, create: boolean): Promise<Buffer> {
  const kf = join(folder, KEY_FILE);
  if (existsSync(kf)) {
    const meta = JSON.parse(await readFile(kf, "utf8"));
    const key = await keyFor(password, Buffer.from(meta.salt, "base64"));
    try {
      const v = await decryptText(key, join(folder, meta.verifier), work);
      if (v !== VERIFY_TEXT) throw new Error();
    } catch { throw new WrongPassword(); }
    return key;
  }
  if (!create) throw new Error("There is no Garden backup in that folder.");
  const salt = randomBytes(16);
  const key = await keyFor(password, salt);
  await encryptText(key, VERIFY_TEXT, join(folder, "verifier.enc"), work);
  await writeFile(kf, JSON.stringify({ version: 1, kdf: "scrypt", cipher: "aes-256-gcm", salt: salt.toString("base64"), verifier: "verifier.enc" }, null, 1));
  return key;
}

// ---------------------------------------------------------------- state (when did it last work?)

type State = { since?: string; lastOk?: string; lastOkDay?: string; lastTried?: string; lastError?: string | null };
function readState(): State { try { return JSON.parse(readFileSync(backupStatePath(), "utf8")); } catch { return {}; } }
function writeState(s: State) { writeFileSync(backupStatePath(), JSON.stringify(s)); }

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const dayNumber = (day: string) => Math.floor(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) / 864e5);

export function backupStatus(now = new Date()) {
  const folder = backupDir();
  const s = readState();
  const today = localDay(now);
  const lastDay = s.lastOk ? localDay(new Date(s.lastOk)) : null;
  const time = s.lastOk ? new Date(s.lastOk).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  // "Backed up today 03:12" / "Backed up yesterday 03:12" / "Last backed up Tuesday 03:12"
  let line = "Backups aren't set up yet";
  if (folder && lastDay) {
    const ago = dayNumber(today) - dayNumber(lastDay);
    line = ago === 0 ? `Backed up today ${time}` : ago === 1 ? `Backed up yesterday ${time}` : `Last backed up ${WEEKDAYS[new Date(s.lastOk!).getDay()]} ${time}`;
  } else if (folder) line = "No Backup has run yet";
  // Two days running without one -> the This week note. Judged by the Mac's calendar days.
  let warning: null | { text: string } = null;
  if (folder) {
    const ref = lastDay ?? (s.since ? localDay(new Date(s.since)) : null);
    if (ref && dayNumber(today) - dayNumber(ref) >= 2)
      warning = { text: lastDay ? `Backup hasn't run since ${WEEKDAYS[new Date(s.lastOk!).getDay()]}` : "Backup hasn't run yet" };
  }
  return { folder, line, lastOk: s.lastOk ?? null, lastError: s.lastError ?? null, warning };
}

// ---------------------------------------------------------------- making a Backup

export type BackupDeps = { password: PasswordSource; now?: () => Date };
let running: Promise<{ ok: boolean; message: string }> | null = null;

/** One Backup now. Only one runs at a time. Never throws: the result says what happened (and no result ever contains the password). */
export function runBackup(sqlite: Db, deps: BackupDeps): Promise<{ ok: boolean; message: string }> {
  running ??= doBackup(sqlite, deps).finally(() => { running = null; });
  return running;
}
async function doBackup(sqlite: Db, deps: BackupDeps) {
  const now = (deps.now ?? (() => new Date()))();
  const fail = (message: string) => { writeState({ ...readState(), lastTried: now.toISOString(), lastError: message }); return { ok: false, message }; };
  const folder = backupDir();
  if (!folder) return fail("Choose the Google Drive folder for Backups first.");
  if (!existsSync(folder)) return fail(`The Backup folder is missing: ${folder}. Is Google Drive running on this Mac?`);
  const password = await deps.password();
  if (!password) return fail("The backup password isn't in this Mac's Keychain yet. Set it with: npm run backup:password");
  const work = await mkdtemp(join(tmpdir(), "garden-backup-"));
  try {
    const key = await openKey(folder, password, work, true);
    const day = localDay(now);
    // 1. the database: a consistent copy even while the Garden is in use
    const copy = join(work, "garden.db");
    await sqlite.backup(copy);
    await encryptFile(key, copy, join(folder, "db", `garden-${day}.db.enc`));
    // 2. each image, once
    const names = existsSync(imagesDir()) ? (await readdir(imagesDir())).filter((n) => !n.startsWith(".")) : [];
    let added = 0;
    for (const n of names) {
      const target = join(folder, "images", `${n}.enc`);
      if (existsSync(target)) continue;
      await encryptFile(key, join(imagesDir(), n), target);
      added++;
    }
    // 3. which images belong to this day
    await encryptText(key, JSON.stringify({ day, images: names }), join(folder, "manifests", `manifest-${day}.json.enc`), work);
    // 4. keep four weeks
    await prune(folder, key, work, day);
    writeState({ ...readState(), lastOk: now.toISOString(), lastOkDay: day, lastTried: now.toISOString(), lastError: null });
    return { ok: true, message: `Backed up (${names.length} images, ${added} new).` };
  } catch (e) {
    return fail(e instanceof WrongPassword ? e.message : `The Backup didn't finish: ${(e as Error).message}`);
  } finally { await rm(work, { recursive: true, force: true }); }
}

const dayOfName = (n: string) => n.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
async function list(dir: string) { return readdir(dir).catch(() => [] as string[]); }

async function prune(folder: string, key: Buffer, work: string, today: string) {
  const limit = dayNumber(today) - KEEP_DAYS;
  const dbs = (await list(join(folder, "db"))).filter((n) => n.endsWith(".enc"));
  const mans = (await list(join(folder, "manifests"))).filter((n) => n.endsWith(".enc"));
  for (const n of [...dbs.map((n) => ["db", n]), ...mans.map((n) => ["manifests", n])]) {
    const d = dayOfName(n[1]);
    if (d && dayNumber(d) <= limit) await rm(join(folder, n[0], n[1]), { force: true });
  }
  // images no kept day lists any more
  const keep = new Set<string>();
  for (const n of await list(join(folder, "manifests"))) {
    if (!n.endsWith(".enc")) continue;
    try { for (const i of JSON.parse(await decryptText(key, join(folder, "manifests", n), work)).images) keep.add(`${i}.enc`); } catch { return; } // unreadable list: delete nothing
  }
  for (const n of await list(join(folder, "images"))) if (n.endsWith(".enc") && !keep.has(n)) await rm(join(folder, "images", n), { force: true });
}

// ---------------------------------------------------------------- looking at and restoring Backups

/** The days that can be restored, newest first. */
export async function backupDays(folder: string): Promise<string[]> {
  const days = (await list(join(folder, "db"))).map((n) => (n.endsWith(".db.enc") ? dayOfName(n) : null)).filter((d): d is string => !!d);
  return days.sort().reverse();
}

export type RestoreResult = { day: string; into: string; objects: number; images: number; imagesMissing: number; integrity: string };

/**
 * Put one day's Backup into `into`, a folder that must be empty or new. It never touches the Garden in use.
 * It then opens the restored database and checks it, so "it works" is shown, not assumed.
 */
export async function restoreBackup(folder: string, password: string, into: string, day: string | "latest" = "latest"): Promise<RestoreResult> {
  const days = await backupDays(folder);
  if (!days.length) throw new Error("There are no Backups in that folder.");
  const chosen = day === "latest" ? days[0] : day;
  if (!days.includes(chosen)) throw new Error(`There is no Backup for ${chosen}. Days available: ${days.join(", ")}`);
  if (existsSync(into) && (await readdir(into)).length) throw new Error("The restore folder must be empty. The Garden in use is never overwritten.");
  const work = await mkdtemp(join(tmpdir(), "garden-restore-"));
  try {
    const key = await openKey(folder, password, work, false);
    await mkdir(into, { recursive: true });
    await decryptFile(key, join(folder, "db", `garden-${chosen}.db.enc`), join(into, "garden.db"));
    const manifest = JSON.parse(await decryptText(key, join(folder, "manifests", `manifest-${chosen}.json.enc`), work)) as { images: string[] };
    let images = 0, imagesMissing = 0;
    await mkdir(join(into, "images"), { recursive: true });
    for (const n of manifest.images) {
      const src = join(folder, "images", `${n}.enc`);
      if (!existsSync(src)) { imagesMissing++; continue; }
      await decryptFile(key, src, join(into, "images", n));
      images++;
    }
    const check = new Database(join(into, "garden.db"), { readonly: true });
    try {
      const integrity = String(check.pragma("integrity_check", { simple: true }));
      const objects = (check.prepare("SELECT count(*) AS n FROM objects").get() as { n: number }).n;
      return { day: chosen, into, objects, images, imagesMissing, integrity };
    } finally { check.close(); }
  } finally { await rm(work, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- the daily check

/** Called every few minutes. Makes today's Backup once the clock is past 03:00 and none has worked today. */
export async function backupIfDue(sqlite: Db, deps: BackupDeps) {
  const now = (deps.now ?? (() => new Date()))();
  if (!backupDir() || now.getHours() < BACKUP_HOUR) return null;
  const s = readState();
  if (s.lastOk && localDay(new Date(s.lastOk)) === localDay(now)) return null;
  if (s.lastError && s.lastTried && now.getTime() - new Date(s.lastTried).getTime() < RETRY_AFTER_FAILURE_MS) return null;
  return runBackup(sqlite, deps);
}
