// The owner's search (issue #33). Everything here runs on this Mac from the Garden's own full-text index (SQLite FTS5);
// no AI and nothing leaves the machine. Private Objects are searched like any other (CONTEXT.md: Private), Bin Objects never.
//
// What it reads: titles, bodies, Tags, field values (a Source's extracted text is one), and AI Notes. Daily Inbox comments and
// Inquiries will join the same index when those exist (phone Capture and the Researcher are later builds).
//
// How a query is read: every word must be found, anywhere in the same Object, and a word matches the start of a word
// ("conc" finds "concept"). Typo tolerance (decided here): if a word finds nothing, it is swapped for the closest words
// the Garden really contains (one slip for words of 4-7 letters, two for longer ones) and the page says so.
import type Database from "better-sqlite3";
import { MENTION } from "./mentions.ts";
import { filterSql, summarise, titleOf, type Filters, type Sort } from "./objects.ts";

type Db = Database.Database;
type OriginInfo = { origin: "source" | "ai" | "owner"; aiRole: string | null; aiModel: string | null; aiDate: string | null; approved: boolean };
const originOf = (r: any): OriginInfo => ({ origin: r.origin, aiRole: r.ai_role ?? null, aiModel: r.ai_model ?? null, aiDate: r.ai_date ?? null, approved: r.origin === "ai" && !!r.approved });

export type Where = "title" | "tag" | "body" | "field" | "note";
type Piece = { key: string; objectId: string; where: Where; label: string; text: string; origin: OriginInfo; weight: number; words: string[] };

const WEIGHT: Record<Where, number> = { title: 10, tag: 6, body: 4, field: 3, note: 2 };
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const wordsOf = (s: string) => fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];

/** The text of a block or field with Mentions written out as the title they point to. */
const plain = (db: Db, text: string) => text.replace(MENTION, (_m, id) => titleOf(db, id));

function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Words the Garden really holds that are one or two slips away from `term` (never the term itself). */
function closeWords(db: Db, term: string): string[] {
  if (term.length < 4) return [];
  const max = term.length >= 8 ? 2 : 1;
  const vocab = (db.prepare("SELECT term FROM search_vocab WHERE length(term) >= ?").all(term.length - max) as any[]).map((r) => r.term as string);
  const tagWords = (db.prepare("SELECT name FROM tags").all() as any[]).flatMap((r) => wordsOf(r.name));
  const found = new Map<string, number>();
  for (const w of new Set([...vocab, ...tagWords])) {
    if (w === term || /\d/.test(w)) continue; // numbers and the letters-and-digits of Mention references are not words
    const d = Math.min(distance(term, w, max), w.length > term.length ? distance(term, w.slice(0, term.length), max) + 1 : max + 1);
    if (d <= max) found.set(w, d);
  }
  return [...found].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length).slice(0, 6).map(([w]) => w);
}

/** Every piece of text in the Garden that has a word starting with one of `variants`. */
function piecesFor(db: Db, variants: string[], eligible: Set<string>): Piece[] {
  const out: Piece[] = [];
  const fieldLabel = new Map((db.prepare("SELECT key, label FROM field_definitions").all() as any[]).map((r) => [r.key, r.label as string]));
  const blockOf = db.prepare("SELECT * FROM blocks WHERE id = ?");
  const fieldOf = db.prepare("SELECT * FROM field_values WHERE id = ?");
  const noteOf = db.prepare("SELECT * FROM ai_notes WHERE id = ?");
  for (const v of variants) {
    const rows = db.prepare("SELECT rowid AS rid, object_id, kind, text FROM search_index WHERE search_index MATCH ?").all(`"${v}"*`) as any[];
    for (const r of rows) {
      if (!eligible.has(r.object_id)) continue;
      const text = plain(db, r.text as string);
      const words = wordsOf(text).filter((w) => w.startsWith(v));
      if (!words.length) continue; // the match was only inside a Mention reference
      if (r.kind === "block") {
        const b = blockOf.get(r.rid / 2) as any;
        if (b) out.push({ key: `b${r.rid}`, objectId: r.object_id, where: "body", label: "Text", text, origin: originOf(b), weight: WEIGHT.body, words });
      } else if (r.kind === "field") {
        const f = fieldOf.get((r.rid - 1) / 2) as any;
        if (!f || f.field === "extraction") continue;
        const title = f.field === "title";
        out.push({ key: `f${r.rid}`, objectId: r.object_id, where: title ? "title" : "field", label: title ? "Title" : (fieldLabel.get(f.field) ?? f.field), text, origin: originOf(f), weight: title ? WEIGHT.title : WEIGHT.field, words });
      } else if (r.kind === "note") {
        const n = noteOf.get(-r.rid) as any;
        if (n) out.push({ key: `n${r.rid}`, objectId: r.object_id, where: "note", label: "AI Note", text, origin: originOf({ ...n, origin: "ai" }), weight: WEIGHT.note, words });
      }
    }
  }
  const tags = db.prepare("SELECT ot.object_id, t.id, t.name, ot.origin, ot.ai_role, ot.ai_model, ot.ai_date FROM object_tags ot JOIN tags t ON t.id = ot.tag_id").all() as any[];
  for (const t of tags) {
    if (!eligible.has(t.object_id)) continue;
    const words = wordsOf(t.name).filter((w) => variants.some((v) => w.startsWith(v)));
    if (words.length) out.push({ key: `t${t.id}:${t.object_id}`, objectId: t.object_id, where: "tag", label: "Tag", text: `#${t.name}`, origin: originOf(t), weight: WEIGHT.tag, words });
  }
  return out;
}

/** The sentence that holds the match, shortened if it runs long. */
function sentenceWith(text: string, terms: string[]): string {
  const parts = text.split(/(?<=[.!?])\s+|\n+/).filter(Boolean);
  const hit = parts.find((p) => wordsOf(p).some((w) => terms.some((t) => w.startsWith(t)))) ?? parts[0] ?? text;
  if (hit.length <= 240) return hit.trim();
  const at = Math.max(0, fold(hit).search(new RegExp(terms.map((t) => t.replace(/[^\p{L}\p{N}]/gu, "")).join("|"), "u")));
  const from = Math.max(0, at - 90);
  return (from > 0 ? "…" : "") + hit.slice(from, from + 240).trim() + (from + 240 < hit.length ? "…" : "");
}

export type Hit = ReturnType<typeof summarise>[number] & {
  title: string;
  match: { where: Where; label: string; text: string; origin: OriginInfo } | null;
};

export function search(db: Db, q: Filters & { q?: string; sort?: string; limit?: number }) {
  const f = filterSql(q);
  const rows = db.prepare(`SELECT o.*, o.rowid AS rowid FROM objects o WHERE ${f.where}`).all(...f.args) as any[];
  const eligible = new Set(rows.map((r) => r.id as string));
  const terms = [...new Set(wordsOf(q.q ?? ""))];
  const sort: Sort = (["relevance", "changed", "created", "title"] as const).find((s) => s === q.sort) ?? (terms.length ? "relevance" : "changed");

  const score = new Map<string, number>();
  const shown = new Map<string, Piece>();
  const highlight = new Set<string>();
  const corrected: { from: string; to: string[] }[] = [];

  if (terms.length) {
    // For each word: the pieces it is found in, by Object. A word that finds nothing is retried as the closest real words.
    const perTerm: Map<string, Piece[]>[] = [];
    for (const t of terms) {
      let pieces = piecesFor(db, [t], eligible);
      if (!pieces.length) {
        const alts = closeWords(db, t);
        if (alts.length) {
          pieces = piecesFor(db, alts, eligible);
          if (pieces.length) corrected.push({ from: t, to: [...new Set(pieces.flatMap((p) => p.words))].slice(0, 3) });
        }
      }
      const by = new Map<string, Piece[]>();
      for (const p of pieces) by.set(p.objectId, [...(by.get(p.objectId) ?? []), p]);
      perTerm.push(by);
    }
    for (const id of [...eligible]) {
      if (!perTerm.every((m) => m.has(id))) { eligible.delete(id); continue; }
      let total = 0;
      const covers = new Map<string, { piece: Piece; n: number }>();
      perTerm.forEach((m, i) => {
        const ps = m.get(id)!;
        total += Math.max(...ps.map((p) => p.weight + (p.words.includes(terms[i]) ? 3 : 0) + (p.where === "title" && fold(p.text).startsWith(terms[i]) ? 2 : 0)));
        for (const p of ps) covers.set(p.key, { piece: p, n: (covers.get(p.key)?.n ?? 0) + 1 });
      });
      score.set(id, total);
      shown.set(id, [...covers.values()].sort((a, b) => b.n - a.n || b.piece.weight - a.piece.weight)[0].piece);
      perTerm.forEach((m) => m.get(id)!.forEach((p) => p.words.forEach((w) => highlight.add(w))));
    }
  }

  let kept = rows.filter((r) => eligible.has(r.id));
  const at = (r: any) => r.updated_at ?? r.created_at;
  if (sort === "relevance" && terms.length) kept.sort((a, b) => score.get(b.id)! - score.get(a.id)! || at(b).localeCompare(at(a)));
  else if (sort === "created") kept.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.rowid - a.rowid);
  else if (sort === "title") { const name = new Map(kept.map((r) => [r.id, titleOf(db, r.id).toLowerCase()])); kept.sort((a, b) => name.get(a.id)!.localeCompare(name.get(b.id)!)); }
  else kept.sort((a, b) => at(b).localeCompare(at(a)) || b.rowid - a.rowid);

  const total = kept.length;
  kept = kept.slice(0, Math.min(Math.max(q.limit ?? 60, 1), 200));
  const hits: Hit[] = summarise(db, kept).map((s) => {
    const p = shown.get(s.id);
    return { ...s, title: titleOf(db, s.id), match: p ? { where: p.where, label: p.label, text: p.where === "tag" || p.where === "title" ? p.text : sentenceWith(p.text, [...highlight]), origin: p.origin } : null };
  });
  return { hits, total, terms: [...highlight], corrected, sort };
}

/** Short cards for these ids, in this order, skipping anything gone or in the Bin (the recent items in ⌘K). */
export function briefs(db: Db, ids: string[]) {
  const live = ids.slice(0, 20).map((id) => db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id)).filter(Boolean) as any[];
  return summarise(db, live).map((s) => ({ ...s, title: titleOf(db, s.id) }));
}
