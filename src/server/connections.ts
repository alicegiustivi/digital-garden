// Connections between Objects (issue #7): one per pair, seven fixed kinds, readable from both ends.
// Also: name search for @ and [[, "Shares words with", and merging two Objects of the same type.
import type Database from "better-sqlite3";
import { BadRequest, setPrivate, summarise, titleOf } from "./objects.ts";
import { MENTION, mentionToken, mentionsInBody, syncMentions } from "./mentions.ts";

type Db = Database.Database;

export const KINDS = ["related", "supports", "contradicts", "builds on", "inspired by", "mentions", "authored by"] as const;
export type Kind = (typeof KINDS)[number];
/** How each kind reads from the Object it points away from, and from the Object it points to. */
const LABELS: Record<Kind, [string, string]> = {
  related: ["related", "related"],
  supports: ["supports", "supported by"],
  contradicts: ["contradicts", "contradicts"],
  "builds on": ["builds on", "built on by"],
  "inspired by": ["inspired by", "inspired"],
  mentions: ["mentions", "mentioned by"],
  "authored by": ["authored by", "author of"],
};
const SYMMETRIC = new Set<string>(["related", "contradicts"]);
const labelFor = (kind: string, subject: boolean) => LABELS[kind as Kind][subject ? 0 : 1];
const live = (db: Db, id: string) => !!db.prepare("SELECT 1 FROM objects WHERE id = ? AND deleted_at IS NULL").get(id);
const originOf = (r: any) => ({ origin: r.origin, aiRole: r.ai_role, aiModel: r.ai_model, aiDate: r.ai_date, approved: r.origin === "ai" && !!r.approved });

/** The paragraph's sentence that holds the reference, with other Mentions shown by name. */
function sentenceAround(db: Db, text: string, id: string): string | null {
  const token = mentionToken(id);
  const alone = text.trim() === token;
  if (alone) return null;
  const plain = (t: string) => t.replace(MENTION, (_m, i) => `“${titleOf(db, i)}”`);
  const parts = text.split(/(?<=[.!?])\s+/);
  const hit = parts.find((p) => p.includes(token)) ?? text;
  const out = plain(hit).trim();
  return out.length > 260 ? out.slice(0, 257) + "…" : out;
}

function sentenceFor(db: Db, me: string, other: string): { text: string; by: "other" | "me" } | null {
  const find = (from: string, target: string) => {
    for (const b of db.prepare("SELECT text FROM blocks WHERE object_id = ? ORDER BY position").all(from) as any[]) {
      if (!b.text.includes(mentionToken(target))) continue;
      const s = sentenceAround(db, b.text, target);
      if (s) return s;
    }
    return null;
  };
  const theirs = find(other, me);
  if (theirs) return { text: theirs, by: "other" };
  const mine = find(me, other);
  return mine ? { text: mine, by: "me" } : null;
}

const shapeOther = (db: Db, id: string) => {
  const row = db.prepare("SELECT * FROM objects WHERE id = ?").get(id);
  const [s] = summarise(db, [row]);
  return { id, type: s.type, title: titleOf(db, id), private: s.private, tags: s.tags, connectionCount: s.connectionCount, portrait: s.portrait };
};

export function connectionsOf(db: Db, id: string) {
  if (!live(db, id)) return null;
  const rows = db.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ? ORDER BY id").all(id, id) as any[];
  return rows
    .map((c) => {
      const subject = c.from_id === id;
      const otherId = subject ? c.to_id : c.from_id;
      if (!live(db, otherId)) return null; // in the Bin: kept, but hidden
      const sentence = sentenceFor(db, id, otherId);
      return {
        id: c.id,
        other: shapeOther(db, otherId),
        kind: c.kind as Kind,
        label: labelFor(c.kind, subject),
        subject,
        note: c.note ?? "",
        ...originOf(c),
        sentence: sentence?.text ?? null,
        sentenceBy: sentence?.by ?? null,
        /** A Mention still written in the text: remove the reference to remove the Connection. */
        fromText: c.kind === "mentions" && (mentionsInBody(db, c.from_id).has(c.to_id)),
      };
    })
    .filter(Boolean);
}

/** The labelled list of choices for changing a kind, as read from one Object. */
export const kindChoices = KINDS.flatMap((k) =>
  SYMMETRIC.has(k) ? [{ kind: k, subject: true, label: k }] : [{ kind: k, subject: true, label: LABELS[k][0] }, { kind: k, subject: false, label: LABELS[k][1] }],
);

const cleanNote = (n: unknown) => (typeof n === "string" ? n.replace(/\s+/g, " ").trim().slice(0, 200) : "");

export function connect(db: Db, input: { a?: unknown; b?: unknown; kind?: unknown; note?: unknown }) {
  const { a, b } = input;
  if (typeof a !== "string" || typeof b !== "string") throw new BadRequest("two Objects are needed");
  if (a === b) throw new BadRequest("An Object can't be connected to itself");
  if (!live(db, a) || !live(db, b)) throw new BadRequest("That Object could not be found");
  const kind = (input.kind ?? "related") as string;
  if (!KINDS.includes(kind as Kind) || kind === "mentions") throw new BadRequest("Pick another kind: Mentions come from the text");
  if (db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(a, b, b, a))
    throw new BadRequest("These two are already connected");
  const r = db.prepare("INSERT INTO connections (from_id, to_id, kind, origin, note) VALUES (?, ?, ?, 'owner', ?)").run(a, b, kind, cleanNote(input.note) || null);
  return connectionsOf(db, a)!.find((c: any) => c.id === Number(r.lastInsertRowid));
}

export function updateConnection(db: Db, id: number, patch: { kind?: unknown; subject?: unknown; note?: unknown }) {
  const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as any;
  if (!c) return null;
  db.transaction(() => {
    if (patch.kind !== undefined) {
      const kind = patch.kind as string;
      if (!KINDS.includes(kind as Kind)) throw new BadRequest("unknown kind");
      if (kind === "mentions" && c.kind !== "mentions" && !mentionsInBody(db, c.from_id).has(c.to_id) && !mentionsInBody(db, c.to_id).has(c.from_id))
        throw new BadRequest("A Mention comes from the text: write the reference in a body");
      // `subject` is the Object that "supports", "builds on" and so on. Flip the ends when it is the other one.
      let { from_id: from, to_id: to } = c;
      if (typeof patch.subject === "string" && !SYMMETRIC.has(kind)) {
        if (patch.subject !== from && patch.subject !== to) throw new BadRequest("subject must be one of the two Objects");
        if (patch.subject === to) [from, to] = [to, from];
      }
      // Choosing a kind is the owner's decision, so the Connection becomes theirs (ADR 0001).
      db.prepare("UPDATE connections SET kind = ?, from_id = ?, to_id = ?, origin = 'owner', ai_role = NULL, ai_model = NULL, ai_date = NULL, approved = 0 WHERE id = ?").run(kind, from, to, id);
    }
    if (patch.note !== undefined) db.prepare("UPDATE connections SET note = ? WHERE id = ?").run(cleanNote(patch.note) || null, id);
  })();
  return db.prepare("SELECT * FROM connections WHERE id = ?").get(id);
}

export function disconnect(db: Db, id: number) {
  const c = db.prepare("SELECT * FROM connections WHERE id = ?").get(id) as any;
  if (!c) return false;
  if (c.kind === "mentions" && (mentionsInBody(db, c.from_id).has(c.to_id) && live(db, c.to_id)))
    throw new BadRequest("This one comes from a Mention in the text. Remove the Mention, or give it another kind.");
  db.prepare("DELETE FROM connections WHERE id = ?").run(id);
  return true;
}

/** What the editor needs to draw each Mention in a body: a quiet link, or an Object Card on its own line. */
export function mentionInfo(db: Db, id: string) {
  const ids = [...mentionsInBody(db, id)];
  const out: Record<string, any> = {};
  for (const m of ids) {
    if (!live(db, m)) { out[m] = { id: m, missing: true, inBin: !!db.prepare("SELECT 1 FROM objects WHERE id = ?").get(m) }; continue; }
    const c = db.prepare("SELECT * FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(id, m, m, id) as any;
    out[m] = { ...shapeOther(db, m), missing: false, kind: c?.kind ?? null, label: c ? labelFor(c.kind, c.from_id === id) : null };
  }
  return out;
}

/** Name search for @ and [[ (and Connect). Works on every Object including Private ones; nothing leaves the Mac. */
export function searchObjects(db: Db, q: { q?: string; type?: string; exclude?: string; limit?: number }) {
  const needle = (q.q ?? "").trim().toLowerCase();
  const where = ["o.deleted_at IS NULL"];
  const args: unknown[] = [];
  if (q.type) { where.push("o.type = ?"); args.push(q.type); }
  if (q.exclude) { where.push("o.id <> ?"); args.push(q.exclude); }
  const rows = db
    .prepare(`SELECT o.* FROM objects o WHERE ${where.join(" AND ")} ORDER BY coalesce(o.updated_at, o.created_at) DESC, o.rowid DESC`)
    .all(...args) as any[];
  const aliases = new Map((db.prepare("SELECT object_id, value FROM field_values WHERE field = 'aliases'").all() as any[]).map((r) => [r.object_id, r.value.toLowerCase()]));
  const scored: { row: any; rank: number }[] = [];
  for (const row of rows) {
    if (!needle) { scored.push({ row, rank: 0 }); continue; }
    const t = titleOf(db, row.id).toLowerCase();
    let rank = -1;
    if (t.startsWith(needle)) rank = 0;
    else if (t.split(/[\s\-_/]+/).some((w) => w.startsWith(needle))) rank = 1;
    else if (t.includes(needle)) rank = 2;
    else if (aliases.get(row.id)?.includes(needle)) rank = 3;
    if (rank >= 0) scored.push({ row, rank });
  }
  scored.sort((a, b) => a.rank - b.rank); // stable: newest first within a rank
  const top = scored.slice(0, Math.min(q.limit ?? 8, 30)).map((s) => s.row);
  const sums = summarise(db, top);
  const connected = q.exclude ? connectedIds(db, q.exclude) : new Set<string>();
  return sums.map((s) => ({ ...s, title: titleOf(db, s.id), connected: connected.has(s.id) }));
}

const connectedIds = (db: Db, id: string) =>
  new Set((db.prepare("SELECT from_id, to_id FROM connections WHERE from_id = ? OR to_id = ?").all(id, id) as any[]).map((c) => (c.from_id === id ? c.to_id : c.from_id)));

// ---------- Shares words with ----------
const STOP = new Set(
  "about above after again also another because been before being between both cannot could does doing done down during each either else even ever every from further have having here hers himself into itself just keep know like made make many more most much must myself only other ours over same shall should since some such than that their theirs them then there these they this those through under until upon very want well were what when where which while will with within without would your yours yourself".split(" "),
);
const SKIP_FIELDS = new Set(["link", "format", "status", "extraction", "kind"]);
const wordsOf = (text: string) => new Set((text.replace(MENTION, " ").toLowerCase().match(/\p{L}{4,}/gu) ?? []).filter((w) => !STOP.has(w)));

/** Up to 5 Objects that share unusual words or Tags with this one. Worked out on this Mac from the Garden's own text, never stored, no AI. */
export function sharesWords(db: Db, id: string) {
  if (!live(db, id)) return null;
  const objs = db.prepare("SELECT id FROM objects WHERE deleted_at IS NULL").all() as any[];
  const texts = new Map<string, string[]>(objs.map((o) => [o.id, []]));
  for (const b of db.prepare("SELECT object_id, text FROM blocks").all() as any[]) texts.get(b.object_id)?.push(b.text);
  for (const f of db.prepare("SELECT object_id, field, value FROM field_values").all() as any[]) if (!SKIP_FIELDS.has(f.field)) texts.get(f.object_id)?.push(f.value);
  const tagsBy = new Map<string, Set<string>>();
  for (const r of db.prepare("SELECT ot.object_id, t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id").all() as any[]) {
    if (!tagsBy.has(r.object_id)) tagsBy.set(r.object_id, new Set());
    tagsBy.get(r.object_id)!.add(r.name);
  }
  const words = new Map<string, Set<string>>();
  const df = new Map<string, number>();
  for (const [oid, parts] of texts) {
    const w = wordsOf(parts.join("\n"));
    words.set(oid, w);
    for (const x of w) df.set(x, (df.get(x) ?? 0) + 1);
  }
  const N = objs.length;
  const common = (w: string) => N >= 6 && (df.get(w) ?? 0) > N * 0.5;
  const mine = words.get(id)!;
  const myTags = tagsBy.get(id) ?? new Set();
  const skip = connectedIds(db, id);
  const found: { id: string; score: number; shared: string[]; tags: string[] }[] = [];
  for (const [oid, w] of words) {
    if (oid === id || skip.has(oid)) continue;
    const shared = [...mine].filter((x) => w.has(x) && !common(x));
    const tags = [...(tagsBy.get(oid) ?? [])].filter((t) => myTags.has(t));
    const rare = shared.some((x) => (df.get(x) ?? 0) <= 2);
    if (!(shared.length >= 2 || tags.length >= 1 || rare)) continue;
    const idf = (x: string) => Math.log(1 + N / (df.get(x) ?? 1));
    shared.sort((a, b) => idf(b) - idf(a));
    found.push({ id: oid, score: shared.reduce((s, x) => s + idf(x), 0) + tags.length * 2, shared: shared.slice(0, 4), tags });
  }
  found.sort((a, b) => b.score - a.score);
  return found.slice(0, 5).map((f) => ({ ...shapeOther(db, f.id), shared: f.shared, sharedTags: f.tags }));
}

// ---------- Merge ----------
type Conn = { id: number; from_id: string; to_id: string; kind: string; origin: string; ai_role: any; ai_model: any; ai_date: any; approved: number; note: string | null };
const rel = (c: Conn, me: string) => (SYMMETRIC.has(c.kind) ? c.kind : `${c.kind}:${c.from_id === me ? "out" : "in"}`);
const specific = (k: string) => k !== "related" && k !== "mentions";
const joinNotes = (a: string | null, b: string | null) => [a, b].filter((x, i, all) => x && all.indexOf(x) === i).join(" · ") || null;

/** Decide which of two Connections to the same third Object survives (issue #7). null = the owner has to choose. */
function winner(a: Conn, meA: string, b: Conn, meB: string): "a" | "b" | null {
  if (rel(a, meA) === rel(b, meB)) return "a";
  if ((a.origin === "ai") !== (b.origin === "ai")) return a.origin === "ai" ? "b" : "a"; // the owner's beats AI-origin
  if (specific(a.kind) !== specific(b.kind)) return specific(a.kind) ? "a" : "b"; // a specific kind beats related or mentions
  if (!specific(a.kind) && !specific(b.kind)) return a.kind === "mentions" ? "a" : "b"; // only related vs mentions can differ here
  return null;
}

export function mergeObjects(db: Db, keepId: string, dropId: string, picks: Record<string, string> = {}) {
  if (keepId === dropId) throw new BadRequest("Pick two different Objects");
  const keep = db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(keepId) as any;
  const drop = db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(dropId) as any;
  if (!keep || !drop) throw new BadRequest("That Object could not be found");
  if (keep.type !== drop.type) throw new BadRequest("Only two Objects of the same type can be merged");

  const all = (id: string) => db.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ?").all(id, id) as Conn[];
  const otherEnd = (c: Conn, me: string) => (c.from_id === me ? c.to_id : c.from_id);
  const keepBy = new Map(all(keepId).map((c) => [otherEnd(c, keepId), c]));
  const plan: { drop: Conn; keep: Conn | null; win: "keep" | "drop" | null }[] = [];
  for (const c of all(dropId)) {
    const x = otherEnd(c, dropId);
    if (x === keepId) { plan.push({ drop: c, keep: null, win: null }); continue; } // between the two: nothing left to connect
    const k = keepBy.get(x) ?? null;
    if (!k) { plan.push({ drop: c, keep: null, win: "drop" }); continue; }
    const w = winner(k, keepId, c, dropId);
    plan.push({ drop: c, keep: k, win: w === "a" ? "keep" : w === "b" ? "drop" : picks[x] === "keep" ? "keep" : picks[x] === "drop" ? "drop" : null });
  }
  const asks = plan.filter((p) => p.keep && p.win === null);
  if (asks.length)
    return {
      needsChoice: asks.map((p) => {
        const x = otherEnd(p.drop, dropId);
        const say = (c: Conn, me: string) => ({ kind: c.kind, label: labelFor(c.kind, c.from_id === me), note: c.note ?? "" });
        return { otherId: x, other: shapeOther(db, x), keep: say(p.keep!, keepId), drop: say(p.drop, dropId) };
      }),
    };

  db.transaction(() => {
    for (const p of plan) {
      const x = otherEnd(p.drop, dropId);
      if (x === keepId) { db.prepare("DELETE FROM connections WHERE id = ?").run(p.drop.id); continue; }
      if (!p.keep) { db.prepare("UPDATE connections SET from_id = CASE WHEN from_id = ? THEN ? ELSE from_id END, to_id = CASE WHEN to_id = ? THEN ? ELSE to_id END WHERE id = ?").run(dropId, keepId, dropId, keepId, p.drop.id); continue; }
      const note = joinNotes(p.keep.note, p.drop.note); // both notes are kept
      if (p.win === "drop") {
        const d = p.drop;
        db.prepare("UPDATE connections SET kind = ?, from_id = ?, to_id = ?, origin = ?, ai_role = ?, ai_model = ?, ai_date = ?, approved = ?, note = ? WHERE id = ?")
          .run(d.kind, d.from_id === dropId ? keepId : d.from_id, d.to_id === dropId ? keepId : d.to_id, d.origin, d.ai_role, d.ai_model, d.ai_date, d.approved, note, p.keep.id);
      } else db.prepare("UPDATE connections SET note = ? WHERE id = ?").run(note, p.keep.id);
      db.prepare("DELETE FROM connections WHERE id = ?").run(p.drop.id);
    }
    // The rest of the duplicate comes along: Tags, field values the kept one lacks, its words, its picture.
    db.prepare("INSERT OR IGNORE INTO object_tags (object_id, tag_id, origin, ai_role, ai_model, ai_date) SELECT ?, tag_id, origin, ai_role, ai_model, ai_date FROM object_tags WHERE object_id = ?").run(keepId, dropId);
    db.prepare("DELETE FROM object_tags WHERE object_id = ?").run(dropId);
    db.prepare("UPDATE OR IGNORE field_values SET object_id = ? WHERE object_id = ?").run(keepId, dropId);
    db.prepare("DELETE FROM field_values WHERE object_id = ?").run(dropId);
    if (!keep.title && drop.title) db.prepare("UPDATE objects SET title = ? WHERE id = ?").run(drop.title, keepId);
    let pos = (db.prepare("SELECT coalesce(max(position), -1) AS m FROM blocks WHERE object_id = ?").get(keepId) as any).m;
    for (const b of db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(dropId) as any[])
      db.prepare("INSERT INTO blocks (object_id, position, text, origin, ai_role, ai_model, ai_date) VALUES (?, ?, ?, ?, ?, ?, ?)").run(keepId, ++pos, b.text, b.origin, b.ai_role, b.ai_model, b.ai_date);
    db.prepare("DELETE FROM blocks WHERE object_id = ?").run(dropId);
    db.prepare("UPDATE OR IGNORE source_images SET object_id = ? WHERE object_id = ?").run(keepId, dropId);
    db.prepare("UPDATE OR IGNORE person_portraits SET object_id = ? WHERE object_id = ?").run(keepId, dropId);
    db.prepare("UPDATE OR IGNORE open_questions SET object_id = ? WHERE object_id = ?").run(keepId, dropId);
    db.prepare("DELETE FROM open_questions WHERE object_id = ?").run(dropId);
    // Mentions of the merged Object, anywhere, now point at the kept one.
    for (const b of db.prepare("SELECT id, text FROM blocks WHERE instr(text, ?) > 0").all(mentionToken(dropId)) as any[])
      db.prepare("UPDATE blocks SET text = ? WHERE id = ?").run(b.text.split(mentionToken(dropId)).join(mentionToken(keepId)), b.id);
    if (drop.private && !keep.private) setPrivate(db, keepId, true);
    db.prepare("UPDATE objects SET updated_at = datetime('now') WHERE id = ?").run(keepId);
    // The merged Object goes to the Bin; everything of value has moved to the kept one.
    db.prepare("UPDATE objects SET deleted_at = datetime('now') WHERE id = ?").run(dropId);
    syncMentions(db, keepId);
  })();
  return { merged: true, keepId };
}
