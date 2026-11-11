// The Archivist describes a Person or a Concept (CONTEXT.md: Archivist, AI Contribution).
// A Person gets a description, the years lived and links; a Concept gets its definition (its lead field). All of it is written
// ONLY from what the Garden's own Sources say about the subject (the passages of their extracts that mention it), never from the
// model's general knowledge, so nothing is invented. It is applied directly, marked ✦ with role, model and date, and undone in one click
// (ADR 0001, 0003). The owner's own values are never touched, and an earlier AI value is only replaced by a newer one (so the
// description can grow as more Sources are connected). Private Objects are never read, as a Source or as the subject.
import type Database from "better-sqlite3";
import { readable, clip, knownTags, subjectTerms, VAGUE_TAGS } from "./ai-prompt.ts";
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

export type Evidence = { title: string; by: string; published: string; text: string };

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
    const text = clip((hit.length ? hit.join("\n") : r.kind === "authored by" ? extract : "").trim(), PER_SOURCE);
    if (!text) continue;
    total += text.length;
    out.push({ title: titleOf(db, r.id), by: String(field(db, r.id, "authors")?.value ?? ""), published: String(field(db, r.id, "published")?.value ?? ""), text });
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
- Never use outside knowledge, never guess, never invent. No opinions, no Markdown. Do not write in the owner's voice.`,
  concept: `You are the Archivist in a personal knowledge Garden. You define ONE concept using ONLY the passages from the Garden's Sources shown below. You know nothing else about it.
Answer with ONE JSON object and nothing else: {"definition": string or null, "tags": [string]}
Rules:
- "definition" is 2 to 4 plain sentences, neutral: what the concept means in these Sources and what it is used for. If the Sources use it in different ways, say so briefly. null if the passages do not discuss it.
- "tags" are 2 to 4 lowercase noun phrases of 1 to 3 words naming the specific ideas, mechanisms or fields this concept touches in these Sources. Never a vague word (ideas, culture, business), never the concept's own name, never a tag that would fit most items. Reuse a known Tag only when it is exactly right.
- Never use outside knowledge, never guess, never invent. No opinions, no Markdown. Do not write in the owner's voice.`,
} as const;

/** The request for a Person or Concept, or null when the Archivist may not read it, has nothing open to fill, or the Garden has nothing to read. */
export function entityPrompt(db: Db, id: string) {
  const o = db.prepare("SELECT type FROM objects WHERE id = ? AND deleted_at IS NULL AND private = 0").get(id) as any;
  const type = o?.type as "person" | "concept" | undefined;
  if (!type || !ENTITY_FIELDS[type]) return null;
  const open = openFields(db, id, type);
  const evidence = open.length ? evidenceFor(db, id, type) : [];
  if (!open.length || !evidence.length) return { type, open, evidence, messages: null };
  const lines = [`${type === "person" ? "Person" : "Concept"}: ${titleOf(db, id)}`];
  const aliases = type === "concept" ? field(db, id, "aliases")?.value : "";
  if (aliases) lines.push(`Also called: ${aliases}`);
  lines.push("Passages from the Garden's Sources:");
  evidence.forEach((e, i) => lines.push(`[s${i + 1}] "${e.title}"${e.by ? ` by ${e.by}` : ""}${e.published ? ` (${e.published})` : ""}:\n${e.text}`));
  const known = knownTags(db);
  if (known.length) lines.push(`Known Tags in the Garden (use count): ${known.join(", ")}`);
  return { type, open, evidence, messages: [{ role: "system" as const, content: SYSTEM[type] }, { role: "user" as const, content: lines.join("\n\n") }] };
}

/** What the model said, kept only where the passages back it: a year or a link not found in them is dropped. */
export function parseEntity(text: string, type: string, evidence: Evidence[]): { facts: Record<string, string>; tags: string[] } | null {
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
  const tags = Array.isArray(j.tags) ? [...new Set((j.tags as unknown[]).map(cleanTagName).filter((t) => t && t.length <= 40 && !VAGUE_TAGS.has(t)))].slice(0, 4) : [];
  return { facts: out, tags };
}
