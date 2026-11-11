// The Archivist describes a Person or a Concept (CONTEXT.md: Archivist, AI Contribution).
// A Person gets a description, the years lived and links; a Concept gets its definition (its lead field). All of it is written
// ONLY from what the Garden's own Sources say about the subject (the passages of their extracts that mention it), never from the
// model's general knowledge, so nothing is invented. It is applied directly, marked ✦ with role, model and date, and undone in one click
// (ADR 0001, 0003). The owner's own values are never touched, and an earlier AI value is only replaced by a newer one (so the
// description can grow as more Sources are connected). Private Objects are never read, as a Source or as the subject.
import type Database from "better-sqlite3";
import { cleanText, readable, clip, fence, isVague, knownTags, subjectTerms, UNTRUSTED } from "./ai-prompt.ts";
import { jsonOf } from "./archivist.ts";
import { cleanTagName, titleOf } from "./objects.ts";

type Db = Database.Database;

/** The fields the Archivist may fill, by Object Type. The first is the lead field (the one shown under the title). */
export const ENTITY_FIELDS: Record<string, string[]> = { person: ["description", "years", "links"], concept: ["definition"] };

const PER_SOURCE = 2400; // characters of one Source's passages
const TOTAL = 16000;
const MAX_SOURCES = 6;

const field = (db: Db, id: string, f: string) => db.prepare("SELECT value, origin FROM field_values WHERE object_id = ? AND field = ?").get(id, f) as { value: string; origin: string } | undefined;

/** Fields still open to the Archivist: empty, or holding an earlier AI value (never the owner's). */
export const openFields = (db: Db, id: string, type: string) =>
  (ENTITY_FIELDS[type] ?? []).filter((f) => { const cur = field(db, id, f); return !cur || cur.origin === "ai"; });

export type Evidence = { title: string; by: string; published: string; text: string; /** No passage names the subject: only the Source's opening is shown, because the owner connected it. */ opening?: boolean };

/** The Sources connected to this Object, and the passages of each that speak about it. Empty when the Garden has nothing to read yet. */
export function evidenceFor(db: Db, id: string, type: string): Evidence[] {
  const terms = subjectTerms(db, id);
  const rows = db
    .prepare(
      `SELECT c.kind, o.id FROM connections c JOIN objects o ON o.id = CASE WHEN c.from_id = ? THEN c.to_id ELSE c.from_id END
       WHERE (c.from_id = ? OR c.to_id = ?) AND o.type = 'source' AND o.deleted_at IS NULL AND o.private = 0 ORDER BY c.id DESC`,
    )
    .all(id, id, id) as any[];
  const out: Evidence[] = [];
  let total = 0;
  for (const r of rows) {
    if (out.length >= MAX_SOURCES || total >= TOTAL || !readable(db, r.id)) continue;
    const extract = String(field(db, r.id, "captured")?.value ?? "").trim();
    if (!extract) continue;
    const paras = extract.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    const hit = paras.filter((p) => terms.some((t) => p.toLowerCase().includes(t)));
    // Passages that mention the subject. A Source the subject wrote has no need to name them: its opening is read instead.
    // The owner connected this Source to the Concept, so when no passage names it (another form of the word, a different phrasing) its opening still
    // says something about it. It is marked as such. For a Person only passages that name them count (or the opening of a Source they wrote).
    const opening = !hit.length && r.kind !== "authored by" && type === "concept";
    const text = clip((hit.length ? hit.join("\n") : r.kind === "authored by" || opening ? extract : "").trim(), opening ? 1200 : PER_SOURCE);
    if (!text) continue;
    total += text.length;
    out.push({ title: titleOf(db, r.id), by: String(field(db, r.id, "authors")?.value ?? ""), published: String(field(db, r.id, "published")?.value ?? ""), text, ...(opening ? { opening: true } : {}) });
  }
  return out;
}

const SYSTEM = {
  person: `You are the Archivist in a personal knowledge Garden. You describe ONE person using ONLY the passages from the Garden's Sources shown below. You know nothing else about them.
Answer with ONE JSON object and nothing else: {"description": string or null, "years": string or null, "links": string or null, "tags": [string]}
Rules:
- "description" is 2 to 4 plain sentences, neutral: who they are (role, field, works, ideas) and why they appear in these Sources, exactly as the passages state it. One sentence if the passages say little. null if they say nothing about the person.
- "years" is the years they lived, like "1934–2024" or "born 1934", ONLY if a passage states them. Otherwise null.
- "links" are web addresses about this person (their site, profile) that appear word for word in the passages, separated by commas. Otherwise null.
- "tags" are 2 to 4 lowercase noun phrases of 1 to 3 words, each naming something SPECIFIC the passages show this person is about (an idea, field, school of thought, event). Never a vague word (ideas, culture, business), never a role alone (author, expert), never a tag that would fit most items. Reuse a known Tag only when it is exactly right.
- Never use outside knowledge, never guess, never invent. No opinions, no Markdown. Do not write in the owner's voice.
- ${UNTRUSTED}`,
  concept: `You are the Archivist in a personal knowledge Garden. You define ONE concept using ONLY the passages from the Garden's Sources shown below. You know nothing else about it.
Answer with ONE JSON object and nothing else: {"definition": string or null, "tags": [string]}
Rules:
- "definition" is 2 to 4 plain sentences, neutral: what the concept means in these Sources and what it is used for. If the Sources use it in different ways, say so briefly. null if the passages do not discuss it.
- "tags" are 2 to 4 lowercase noun phrases of 1 to 3 words naming the specific ideas, mechanisms or fields this concept touches in these Sources. Never a vague word (ideas, culture, business), never the concept's own name, never a tag that would fit most items. Reuse a known Tag only when it is exactly right.
- A Source marked "no passage names it" is only the opening of a Source the owner connected to this concept: use it only if it clearly discusses the concept, otherwise ignore it.
- Never use outside knowledge, never guess, never invent. No opinions, no Markdown. Do not write in the owner's voice.
- ${UNTRUSTED}`,
} as const;

const TAGS_ONLY = (type: "person" | "concept") => `You are the Archivist in a personal knowledge Garden. You choose Tags for ONE ${type === "person" ? "person" : "concept"}, using ONLY the material below: what is already written about it, and the titles and Tags of the Sources the owner connected to it. You know nothing else about it.
Answer with ONE JSON object and nothing else: {"tags": [string]}
Rules:
- "tags" are 2 to 4 lowercase noun phrases of 1 to 3 words, each naming something SPECIFIC the material shows this ${type} is about or connected with: an idea, field, school of thought, period or technique. When a connected Source's Tag fits, reuse it. Never a vague word (ideas, culture, business, writing alone), never a role alone (author, expert), never ${type === "person" ? "the person's own name" : "the concept's own name"}, never a tag that would fit most items. [] if the material says too little.
- Never use outside knowledge, never guess, never invent. No opinions.
- ${UNTRUSTED}`;

/**
 * What the Garden holds about a Person or Concept when no Source has passages to read: the description or definition already there (with whose
 * words it is), the owner's own words on its page, and the title, author and Tags of each Source connected to it. Null when there is none of that.
 */
function materialFor(db: Db, id: string, type: "person" | "concept"): string | null {
  const lines: string[] = [`${type === "person" ? "Person" : "Concept"}: ${titleOf(db, id)}`];
  const aliases = type === "concept" ? field(db, id, "aliases")?.value : "";
  if (aliases) lines.push(`Also called: ${aliases}`);
  const lead = field(db, id, ENTITY_FIELDS[type][0]);
  let any = false;
  if (lead?.value) { lines.push(`${ENTITY_FIELDS[type][0]} (${lead.origin === "owner" ? "the owner's words" : lead.origin === "ai" ? "written by AI" : "from a Source"}): ${String(lead.value).slice(0, 900)}`); any = true; }
  const own = (db.prepare("SELECT text FROM blocks WHERE object_id = ? AND origin = 'owner' ORDER BY position").all(id) as any[]).map((b) => cleanText(db, b.text)).filter(Boolean).join("\n");
  if (own) { lines.push(`The owner's words on its page: ${own.slice(0, 1500)}`); any = true; }
  const sources = db
    .prepare(
      `SELECT o.id FROM connections c JOIN objects o ON o.id = CASE WHEN c.from_id = ? THEN c.to_id ELSE c.from_id END
       WHERE (c.from_id = ? OR c.to_id = ?) AND o.type = 'source' AND o.deleted_at IS NULL AND o.private = 0 ORDER BY c.id DESC LIMIT 10`,
    )
    .all(id, id, id) as any[];
  const cards = sources.filter((s) => readable(db, s.id)).map((s) => {
    const tags = (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(s.id) as any[]).map((t) => t.name);
    const by = String(field(db, s.id, "authors")?.value ?? "");
    return `- "${titleOf(db, s.id)}"${by ? ` by ${by}` : ""}${tags.length ? ` — Tags: ${tags.slice(0, 6).join(", ")}` : ""}`;
  });
  if (cards.length) { lines.push(`Connected Sources:\n${fence(cards.join("\n"))}`); any = true; }
  if (!any) return null;
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden (use count): ${known.join(", ")}`);
  return lines.join("\n\n");
}

/** The request for a Person or Concept, or null when the Archivist may not read it or the Garden holds nothing to go on. `tagsOnly`: no passage to describe it from, so only Tags are asked for. */
export function entityPrompt(db: Db, id: string) {
  const o = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  const type = o?.type as "person" | "concept" | undefined;
  if (!type || !ENTITY_FIELDS[type]) return null;
  const open = openFields(db, id, type);
  const evidence = open.length ? evidenceFor(db, id, type) : [];
  if (!open.length || !evidence.length) {
    // Nothing to write a description from (book cards without text, no Source yet, or the owner filled it in): Tags can still come from what is held.
    const material = materialFor(db, id, type);
    return { type, open, evidence, tagsOnly: true as boolean, messages: material ? [{ role: "system" as const, content: TAGS_ONLY(type) }, { role: "user" as const, content: material }] : null };
  }
  const lines = [`${type === "person" ? "Person" : "Concept"}: ${titleOf(db, id)}`];
  const aliases = type === "concept" ? field(db, id, "aliases")?.value : "";
  if (aliases) lines.push(`Also called: ${aliases}`);
  lines.push("Passages from the Garden's Sources:");
  evidence.forEach((e, i) => lines.push(`[s${i + 1}] "${e.title}"${e.by ? ` by ${e.by}` : ""}${e.published ? ` (${e.published})` : ""}${e.opening ? " (no passage names it; its opening)" : ""}:\n${fence(e.text)}`));
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden (use count): ${known.join(", ")}`);
  return { type, open, evidence, tagsOnly: false as boolean, messages: [{ role: "system" as const, content: SYSTEM[type] }, { role: "user" as const, content: lines.join("\n\n") }] };
}

/** What the model said, kept only where the passages back it: a year or a link not found in them is dropped. */
export function parseEntity(text: string, type: string, evidence: Evidence[], tagsOnly = false): { facts: Record<string, string>; tags: string[] } | null {
  const j = jsonOf(text);
  if (!j) return null;
  const said = evidence.map((e) => e.text).join("\n");
  const str = (v: unknown, max: number) => (typeof v === "string" && v.replace(/\s+/g, " ").trim() && v.trim().length <= max ? v.replace(/\s+/g, " ").trim() : undefined);
  const out: Record<string, string> = {};
  if (type === "concept") { const d = str(j.definition, 900); if (d) out.definition = d; }
  if (type === "person") {
    const d = str(j.description, 900);
    if (d) out.description = d;
    const years = str(j.years, 40);
    if (years && (years.match(/\d{3,4}/g) ?? []).every((n) => said.includes(n))) out.years = years;
    const links = (typeof j.links === "string" ? j.links.split(/[\s,;]+/) : []).filter((l: string) => /^https?:\/\/\S+$/.test(l) && said.includes(l));
    if (links.length) out.links = [...new Set(links)].join(", ");
  }
  const tags = Array.isArray(j.tags) ? [...new Set((j.tags as unknown[]).map(cleanTagName).filter((t) => t && t.length <= 40 && !isVague(t)))].slice(0, 4) : [];
  return { facts: tagsOnly ? {} : out, tags }; // with no passage to write from, nothing is written but Tags, whatever the model returned
}
