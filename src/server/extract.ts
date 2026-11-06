// Reading a saved link on the Mac (issues #4, #9). Readability pulls the article text, metascraper the
// title, author and date. Pages that need JavaScript are opened in the Mac's own Chrome, hidden.
// Nothing here uses an outside reader service, so Private links are read the same way as any other.
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import metascraper from "metascraper";
import mTitle from "metascraper-title";
import mAuthor from "metascraper-author";
import mDate from "metascraper-date";
import mPublisher from "metascraper-publisher";
import type Database from "better-sqlite3";
import { existsSync } from "node:fs";

type Db = Database.Database;
export type Reading = { title: string | null; author: string | null; published: string | null; text: string; format: string };

const scrape = metascraper([mTitle(), mAuthor(), mDate(), mPublisher()]);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
/** Less text than this and the page probably needs JavaScript. */
const ENOUGH = 400;

async function parse(html: string, url: string): Promise<Reading> {
  const virtualConsole = new VirtualConsole(); // jsdom's CSS complaints are noise
  const dom = new JSDOM(html, { url, virtualConsole });
  const meta = await scrape({ html, url });
  const article = new Readability(dom.window.document.cloneNode(true) as Document).parse();
  const day = meta.date ? String(meta.date).slice(0, 10) : null;
  return {
    title: (meta.title as string) || article?.title || null,
    author: (meta.author as string) || article?.byline || null,
    published: day,
    text: (article?.textContent ?? "").replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim(),
    format: "web page",
  };
}

async function viaFetch(url: string): Promise<Reading | { binary: string }> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`The page answered ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (/pdf/i.test(type)) return { binary: "document" };
  if (/^image\//i.test(type)) return { binary: "image" };
  if (!/html|xml/i.test(type)) return { binary: "document" };
  return parse(await res.text(), res.url || url);
}

async function viaChrome(url: string): Promise<Reading> {
  if (!existsSync(CHROME)) throw new Error("Chrome is not installed");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return await parse(await page.content(), page.url());
  } finally {
    await browser.close();
  }
}

export async function readLink(url: string): Promise<{ reading: Reading | null; status: "extracted" | "partial" | "bookmark only" }> {
  let got: Reading | null = null;
  try {
    const r = await viaFetch(url);
    if ("binary" in r) return { reading: { title: null, author: null, published: null, text: "", format: r.binary }, status: "bookmark only" };
    got = r;
  } catch {}
  if (!got || got.text.length < ENOUGH) {
    try {
      const c = await viaChrome(url);
      if (!got || c.text.length > got.text.length) got = c;
    } catch {}
  }
  if (!got) return { reading: null, status: "bookmark only" };
  if (got.text.length >= ENOUGH) return { reading: got, status: "extracted" };
  return { reading: got, status: got.title || got.text ? "partial" : "bookmark only" };
}

const put = (db: Db, id: string, field: string, value: string) =>
  db
    .prepare(
      `INSERT INTO field_values (object_id, field, value, origin) VALUES (?, ?, ?, 'source')
       ON CONFLICT (object_id, field) DO UPDATE SET value = excluded.value, origin = 'source', ai_role = NULL, ai_model = NULL, ai_date = NULL`,
    )
    .run(id, field, value);

/** Fills a saved link's Source. Anything the owner has already typed there is left alone. A failure never removes the capture. */
export async function extractInto(db: Db, id: string, url: string): Promise<void> {
  let result: Awaited<ReturnType<typeof readLink>>;
  try { result = await readLink(url); } catch { result = { reading: null, status: "bookmark only" }; }
  const mine = (field: string) => !!db.prepare("SELECT 1 FROM field_values WHERE object_id = ? AND field = ? AND origin = 'owner'").get(id, field);
  db.transaction(() => {
    if (!db.prepare("SELECT 1 FROM objects WHERE id = ?").get(id)) return;
    const r = result.reading;
    const title = r?.title || new URL(url).hostname.replace(/^www\./, "");
    if (!mine("title")) { put(db, id, "title", title); db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(title, id); }
    if (r?.author && !mine("authors")) put(db, id, "authors", r.author);
    if (r?.published && !mine("published")) put(db, id, "published", r.published);
    if (r?.text && !mine("captured")) put(db, id, "captured", r.text);
    if (r && r.format !== "web page") put(db, id, "format", r.format);
    put(db, id, "extraction", result.status);
    db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(id);
  })();
}

/** Links still being read when the Garden was closed are read again at the next start. */
export function resumeReading(db: Db) {
  const rows = db
    .prepare(`SELECT l.object_id AS id, l.value AS url FROM field_values e JOIN field_values l ON l.object_id = e.object_id AND l.field = 'link'
              JOIN objects o ON o.id = e.object_id WHERE e.field = 'extraction' AND e.value = 'reading' AND o.deleted_at IS NULL`)
    .all() as { id: string; url: string }[];
  for (const r of rows) void extractInto(db, r.id, r.url);
}
