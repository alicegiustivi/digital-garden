// Looking basic facts up on the web (issue #108, ADR 0009; CONTEXT.md: Archivist, Researcher, Suggestion, Origin, Private).
//
// What leaves this Mac: only the NAME of one readable Object, its title as the owner wrote or captured it, as the search words of one
// request to Wikidata, Wikipedia or Open Library (web-gate.ts). Never its body, Tags, Connections or other fields, never anything
// about a Private Object or one in the Bin, and never a title the Garden had to make up from the body (an Object with no title of
// its own is not looked up). Nothing here uses the AI, so it costs none of the day's free calls.
//
// What comes back is Source Origin (it came from outside) and keeps the link it came from. It waits as a Suggestion ('fact') the
// owner approves or turns down; a value turned down is remembered and not proposed again. When more than one match fits, nothing is
// guessed: the owner chooses, or nothing is offered.
import type Database from "better-sqlite3";
import { readable } from "./ai-prompt.ts";
import { WebError, failWords, type WebGate } from "./web-gate.ts";

type Db = Database.Database;
const ROLE = "Archivist";
const enc = encodeURIComponent;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The kind of fact each field takes, for the four Core types (a type the owner made says so on each property). */
const CORE_KINDS: Record<string, Record<string, Kind>> = {
  person: { description: "summary", years: "years", links: "link" },
  concept: { definition: "summary" },
  source: { authors: "authors", published: "published" },
};
type Kind = "summary" | "years" | "year" | "link" | "authors" | "published";
type Route = "wikidata" | "openlibrary";

export type Candidate = { id: string; label: string; description: string; url: string; site: string };
export type LookupResult = {
  status: "ok" | "choose" | "none" | "nothing-new" | "unavailable" | "offline" | "slow" | "limit" | "error";
  message: string;
  count?: number;
  candidates?: Candidate[];
};

type Fact = { value: string; site: string; url: string };
type Facts = Partial<Record<Kind, Fact>>;

// ---------- Which Objects, which properties ----------

type Target = { ok: true; type: string; name: string; route: Route; fields: Record<string, Kind> } | { ok: false; why: string };

/** The name that would be sent for this Object and the properties that could be filled, or why nothing may be looked up. */
export function targetOf(db: Db, id: string): Target {
  const o = db.prepare("SELECT type, title, private, deleted_at FROM objects WHERE id = ?").get(id) as any;
  if (!o || o.deleted_at) return { ok: false, why: "That Object is in the Bin or gone, so nothing is looked up for it." };
  if (o.private || !readable(db, id)) return { ok: false, why: "This one is Private, so nothing about it is ever sent out." };
  let fields: Record<string, Kind> | undefined = CORE_KINDS[o.type];
  if (!fields) {
    const rows = db.prepare("SELECT fd.key, fd.lookup FROM type_fields tf JOIN field_definitions fd ON fd.key = tf.field WHERE tf.type = ? AND fd.lookup IS NOT NULL ORDER BY tf.position").all(o.type) as any[];
    const kind = (l: string): Kind => (l === "year" ? "year" : l === "link" ? "link" : "summary");
    fields = Object.fromEntries(rows.map((r) => [r.key as string, kind(r.lookup)]));
    if (o.type === "thought" || !Object.keys(fields).length) return { ok: false, why: o.type === "thought" ? "A Thought is your own words, so it is never looked up." : "No property of this type is marked “may be looked up”. You can turn that on in Types." };
  }
  // Only the title the Object itself carries: the Garden's fallback (the start of the body) is never used as a name.
  const name = String(o.title ?? "").replace(/\s+/g, " ").trim();
  if (!name) return { ok: false, why: "Give it a title first: the title is the only thing looked up." };
  if (name.length > 150 || /^https?:\/\//i.test(name)) return { ok: false, why: "The title is a web address or too long to look up. Give it a real name first." };
  let route: Route = "wikidata";
  if (o.type === "source") {
    const format = String((db.prepare("SELECT value FROM field_values WHERE object_id = ? AND field = 'format'").get(id) as any)?.value ?? "");
    if (format && format !== "book") return { ok: false, why: "The Garden can look up books for now. This isn’t one." };
    route = "openlibrary";
  }
  return { ok: true, type: o.type, name, route, fields };
}

// ---------- Wikidata, Wikipedia ----------

async function wikidataSearch(web: WebGate, name: string): Promise<Candidate[]> {
  const j = await web.getJson(`https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(name)}&language=en&uselang=en&type=item&limit=7&format=json`);
  return ((j?.search ?? []) as any[]).filter((x) => /^Q\d+$/.test(String(x?.id))).map((x) => ({
    id: x.id as string, label: String(x.label ?? x.id), description: String(x.description ?? ""), url: `https://www.wikidata.org/wiki/${x.id}`, site: "Wikidata",
  }));
}

const yearOf = (claims: any, prop: string): string | null => {
  const t = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value?.time;
  const m = typeof t === "string" ? /^([+-])0*(\d{1,4})-/.exec(t) : null;
  return m ? (m[1] === "-" ? `${m[2]} BCE` : m[2]) : null;
};
const firstSentences = (text: string, max: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > 120 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…";
};

/** The page a candidate has on Wikipedia, and a short description from it (or Wikidata's own one-liner when it has no page). */
async function wikipediaSummary(web: WebGate, c: Candidate, title: string | undefined): Promise<Fact | null> {
  if (title) {
    const page = `https://en.wikipedia.org/wiki/${enc(title.replace(/ /g, "_"))}`;
    const s = await web.getJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, "_"))}`);
    if (s && s.type !== "disambiguation" && typeof s.extract === "string" && s.extract.trim()) return { value: firstSentences(s.extract, 600), site: "Wikipedia", url: page };
  }
  return c.description ? { value: c.description.charAt(0).toUpperCase() + c.description.slice(1) + ".", site: "Wikidata", url: c.url } : null;
}

async function wikidataFacts(web: WebGate, c: Candidate): Promise<Facts> {
  const j = await web.getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${c.id}&props=claims|sitelinks&sitefilter=enwiki&format=json`);
  const e = j?.entities?.[c.id];
  const claims = e?.claims;
  const title = e?.sitelinks?.enwiki?.title as string | undefined;
  const out: Facts = {};
  const summary = await wikipediaSummary(web, c, title);
  if (summary) out.summary = summary;
  const born = yearOf(claims, "P569"), died = yearOf(claims, "P570");
  if (born) out.years = { value: died ? `${born}–${died}` : `born ${born}`, site: "Wikidata", url: c.url };
  const any = born ?? yearOf(claims, "P571") ?? yearOf(claims, "P577") ?? yearOf(claims, "P580") ?? yearOf(claims, "P585");
  if (any) out.year = { value: any, site: "Wikidata", url: c.url };
  const page = title ? `https://en.wikipedia.org/wiki/${enc(title.replace(/ /g, "_"))}` : c.url;
  out.link = { value: page, site: title ? "Wikipedia" : "Wikidata", url: page };
  return out;
}

// ---------- Open Library ----------

type Book = Candidate & { authors: string; year: string };
async function openLibrarySearch(web: WebGate, name: string): Promise<Book[]> {
  const j = await web.getJson(`https://openlibrary.org/search.json?title=${enc(name)}&limit=8&fields=key,title,author_name,first_publish_year`);
  return ((j?.docs ?? []) as any[]).filter((d) => typeof d?.key === "string" && typeof d?.title === "string").map((d) => {
    const authors = Array.isArray(d.author_name) ? (d.author_name as unknown[]).filter((a): a is string => typeof a === "string").slice(0, 4).join(", ") : "";
    const year = Number.isInteger(d.first_publish_year) ? String(d.first_publish_year) : "";
    return { id: d.key as string, label: d.title as string, description: [authors, year].filter(Boolean).join(" · "), url: `https://openlibrary.org${d.key}`, site: "Open Library", authors, year };
  });
}
const bookFacts = (b: Book): Facts => ({
  ...(b.authors ? { authors: { value: b.authors, site: "Open Library", url: b.url } } : {}),
  ...(b.year ? { published: { value: b.year, site: "Open Library", url: b.url } } : {}),
});

// ---------- The Archivist's "Look up" ----------

const alreadyTurnedDown = (db: Db, id: string, field: string, value: string) =>
  !!db.prepare("SELECT 1 FROM ai_rejected WHERE object_id = ? AND kind = 'fact' AND value = ?").get(id, `${field}:${norm(value)}`);

/**
 * The owner pressed "Look up" on one Object. Returns what happened in plain words. Nothing about the Object is changed except the
 * Suggestions waiting on it; a value is only written when the owner approves it (suggestions.ts).
 * `pick` is the owner's choice among several matches (the id the Garden showed); the search is run again so no value ever comes from the screen.
 */
export async function lookUp(db: Db, web: WebGate, id: string, pick?: string, now: Date = new Date()): Promise<LookupResult> {
  const t = targetOf(db, id);
  if (!t.ok) return { status: "unavailable", message: t.why };
  const site = t.route === "openlibrary" ? "Open Library" : "Wikidata";
  try {
    const found: (Candidate | Book)[] = t.route === "openlibrary" ? await openLibrarySearch(web, t.name) : await wikidataSearch(web, t.name);
    if (!found.length) return { status: "none", message: `No match for “${t.name}” on ${site}. Nothing was changed.` };
    let chosen: Candidate | Book | undefined;
    if (pick) {
      chosen = found.find((c) => c.id === pick);
      if (!chosen) return { status: "none", message: `That match is no longer in ${site}’s results. Nothing was changed.` };
    } else {
      const exact = found.filter((c) => norm(c.label) === norm(t.name));
      if (exact.length === 1) chosen = exact[0];
      else return { status: "choose", message: `More than one thing on ${site} fits “${t.name}”. Choose the right one, or none: the Garden doesn’t guess.`, candidates: (exact.length ? exact : found).slice(0, 6) };
    }
    const facts = t.route === "openlibrary" ? bookFacts(chosen as Book) : await wikidataFacts(web, chosen);
    if (!readable(db, id)) return { status: "unavailable", message: "This one became Private while it was being looked up, so nothing was kept." };

    const proposals: { field: string; fact: Fact }[] = [];
    for (const [field, kind] of Object.entries(t.fields)) {
      const fact = facts[kind];
      if (!fact) continue;
      const cur = db.prepare("SELECT value, origin FROM field_values WHERE object_id = ? AND field = ?").get(id, field) as any;
      if (cur?.origin === "owner" || (cur && norm(cur.value) === norm(fact.value))) continue; // never over the owner's words; nothing new if it is already there
      if (alreadyTurnedDown(db, id, field, fact.value)) continue;
      proposals.push({ field, fact });
    }
    if (!proposals.length)
      return { status: "nothing-new", message: `Found “${chosen.label}” on ${chosen.site}, but there is nothing new to offer: what it could fill is already filled, written by you, or something you turned down.` };
    const date = now.toISOString().slice(0, 10);
    db.transaction(() => {
      db.prepare("DELETE FROM ai_suggestions WHERE object_id = ? AND kind = 'fact'").run(id);
      const ins = db.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'fact', ?, ?, 'web lookup', ?, ?)");
      for (const p of proposals)
        ins.run(id, JSON.stringify({ field: p.field, value: p.fact.value, site: p.fact.site, url: p.fact.url, match: chosen!.label, candidate: chosen!.id }), ROLE, date, now.toISOString());
    })();
    return { status: "ok", count: proposals.length, message: `Found ${proposals.length} ${proposals.length === 1 ? "thing" : "things"} for “${chosen.label}”. Each waits for your Approve, with its link.` };
  } catch (e) {
    if (!(e instanceof WebError)) throw e;
    return { status: e.kind === "offline" || e.kind === "slow" || e.kind === "limit" ? e.kind : "error", message: failWords(e) };
  }
}

// ---------- The Researcher's web switch ----------

export type WebPassage = { name: string; title: string; site: string; url: string; text: string };

/**
 * One passage about a name for the Researcher, only when exactly one Wikidata item carries that exact name (never a guess).
 * `why` says in plain words why there is none.
 */
export async function passageFor(web: WebGate, name: string): Promise<{ passage?: WebPassage; why?: string }> {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 150 || /^https?:\/\//i.test(clean)) return { why: "its title isn’t a name that can be looked up" };
  const found = await wikidataSearch(web, clean);
  const exact = found.filter((c) => norm(c.label) === norm(clean));
  if (!found.length) return { why: "no match" };
  if (exact.length !== 1) return { why: "more than one thing fits that name, so none was used" };
  const c = exact[0];
  const j = await web.getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${c.id}&props=sitelinks&sitefilter=enwiki&format=json`);
  const summary = await wikipediaSummary(web, c, j?.entities?.[c.id]?.sitelinks?.enwiki?.title);
  if (!summary) return { why: "nothing written about it" };
  return { passage: { name: clean, title: c.label, site: summary.site, url: summary.url, text: summary.value } };
}
