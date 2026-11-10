// The Researcher and Inquiries (issue #36; CONTEXT.md: Researcher, Inquiry, AI Note; ADR 0001 Origin; ADR 0002 local-only).
//
// One question takes two requests to the free AI, and no embeddings:
//   1. it is shown compact INDEX CARDS (title, type, Tags, one line) of the Objects it may read and says which it needs;
//   2. it is shown those Objects in full, each labelled with its Origin, and answers.
// What it is shown is decided here, on this Mac. Private Objects (and the Bin) never become a card or a page of text,
// and are not named anywhere: the Garden itself counts how many Private Objects match and adds that line (the AI doesn't).
// An answer is an AI Note that lives in its Inquiry. It reaches an Object only through "Keep on…". Earlier answers are
// never given to the AI as evidence, and links in an answer are only kept if they point at an Object it really read.
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { AI_CONFIG } from "./ai-config.ts";
import { GateError, type Gate } from "./ai-gate.ts";
import { clip, cleanText, readable } from "./ai-prompt.ts";
import { commentForAi } from "./inbox-comments.ts";
import type { Outcome } from "./ai-queue.ts";
import { jsonOf } from "./archivist.ts";
import { sharesWords } from "./connections.ts";
import { MENTION, mentionToken } from "./mentions.ts";
import { BadRequest, createObject, titleOf } from "./objects.ts";

type Db = Database.Database;
export const ROLE = "Researcher";
const MAX_READ = 8; // Objects read in full for one answer
const MAX_CARDS = 150; // index cards shown in the first request
const MAX_QUESTION = 1000;
const TEXT_BUDGET = 70_000; // characters of Objects shown in the second request (the extract of a Source is read, not just its title)
const KINDS = ["related", "supports", "contradicts", "builds on"];

const live = (db: Db, id: string) => db.prepare("SELECT * FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any | undefined;
const iso = (s: string | null) => (s ? (s.includes("T") ? s : s.replace(" ", "T") + "Z") : null);
const brief = (db: Db, id: string) => { const o = live(db, id); return o ? { id, type: o.type as string, title: titleOf(db, id), private: !!o.private } : null; };
const labelOf = (r: any) => (r.origin === "owner" ? "the owner's words" : r.origin === "source" ? "from the Source" : "written by AI, not evidence");

// ---------- Asking ----------

export function createInquiry(db: Db, input: { objectId?: unknown; question?: unknown }) {
  const question = typeof input.question === "string" ? input.question.trim() : "";
  if (!question) throw new BadRequest("Write a question first");
  if (question.length > MAX_QUESTION) throw new BadRequest("That question is too long; keep it under 1,000 characters");
  let objectId: string | null = null;
  if (input.objectId !== undefined && input.objectId !== null) {
    const o = typeof input.objectId === "string" ? live(db, input.objectId) : undefined;
    if (!o) throw new BadRequest("That Object could not be found");
    if (o.private) throw new BadRequest("This one is Private, so the Researcher never reads it");
    objectId = o.id;
  }
  const id = randomUUID();
  const t = new Date().toISOString();
  db.prepare("INSERT INTO inquiries (id, object_id, created_at) VALUES (?, ?, ?)").run(id, objectId, t);
  const turnId = addTurnRow(db, id, question);
  return { id, turnId };
}

const addTurnRow = (db: Db, inquiryId: string, question: string) =>
  Number(db.prepare("INSERT INTO inquiry_turns (inquiry_id, question, created_at) VALUES (?, ?, ?)").run(inquiryId, question, new Date().toISOString()).lastInsertRowid);

/** A follow-up question inside the same Inquiry. */
export function addTurn(db: Db, inquiryId: string, question: unknown) {
  const inq = db.prepare("SELECT * FROM inquiries WHERE id = ? AND deleted_at IS NULL").get(inquiryId) as any;
  if (!inq) return null;
  const q = typeof question === "string" ? question.trim() : "";
  if (!q) throw new BadRequest("Write a question first");
  if (q.length > MAX_QUESTION) throw new BadRequest("That question is too long; keep it under 1,000 characters");
  if (inq.object_id && !readable(db, inq.object_id)) throw new BadRequest("The Object this Inquiry is about is Private or gone, so the Researcher can't read it");
  return addTurnRow(db, inquiryId, q);
}

/** Start the same question again (after Cancel, or when it gave up). */
export function resetTurn(db: Db, turnId: number) {
  const t = db.prepare("SELECT * FROM inquiry_turns WHERE id = ? AND answer IS NULL").get(turnId) as any;
  if (!t) return false;
  cancelJobs(db, turnId);
  db.prepare("UPDATE inquiry_turns SET steps = '[]', picked = NULL, error = NULL WHERE id = ?").run(turnId);
  return true;
}

export function cancelJobs(db: Db, turnId: number) {
  return db.prepare("UPDATE ai_jobs SET status = 'cancelled', updated_at = ? WHERE turn_id = ? AND status IN ('waiting', 'working', 'busy', 'tomorrow')").run(new Date().toISOString(), turnId).changes;
}

// ---------- What the AI may be shown ----------

const STOP = new Set("about above after again also been being between both could does doing during each from have having here into just like more most much must only other over same should some such than that their them then there these they this those through under until very want what when where which while who whom why will with without would your you the and are for not but can how its our out any all was were has had did".split(" "));
/** The words of a question worth matching on. */
export const termsOf = (q: string) => [...new Set((q.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu) ?? []).filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 12);

type Card = { ref: string; id: string };
function candidateIds(db: Db, scope: string | null, question: string): string[] {
  if (scope) {
    const rows = db.prepare("SELECT from_id, to_id FROM connections WHERE from_id = ? OR to_id = ?").all(scope, scope) as any[];
    const ids = new Set(rows.map((c) => (c.from_id === scope ? c.to_id : c.from_id) as string));
    for (const s of sharesWords(db, scope) ?? []) ids.add(s.id);
    ids.delete(scope);
    return [...ids].filter((id) => readable(db, id)).slice(0, 60);
  }
  const terms = termsOf(question);
  const rows = db.prepare("SELECT * FROM objects WHERE deleted_at IS NULL AND private = 0 ORDER BY coalesce(updated_at, created_at) DESC, rowid DESC").all() as any[];
  if (rows.length <= MAX_CARDS) return rows.map((r) => r.id);
  // A big Garden: cards whose title, Tags or text share words with the question come first, then the newest.
  const scored = rows.map((r, i) => {
    const hay = rawText(db, r.id).toLowerCase();
    return { id: r.id as string, i, n: terms.filter((t) => hay.includes(t)).length };
  });
  return scored.sort((a, b) => b.n - a.n || a.i - b.i).slice(0, MAX_CARDS).map((x) => x.id);
}

/** All the words of an Object as plain text, for matching on this Mac only (never sent anywhere). */
function rawText(db: Db, id: string): string {
  const f = (db.prepare("SELECT value FROM field_values WHERE object_id = ? AND field <> 'extraction'").all(id) as any[]).map((r) => r.value);
  const b = (db.prepare("SELECT text FROM blocks WHERE object_id = ?").all(id) as any[]).map((r) => r.text.replace(MENTION, ""));
  const t = (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[]).map((r) => r.name);
  const c = commentForAi(db, id);
  return [titleOf(db, id), ...f, ...b, ...t, ...(c ? [c] : [])].join("\n");
}

function cardLine(db: Db, c: Card): string {
  const o = live(db, c.id);
  const tags = (db.prepare("SELECT t.name FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(c.id) as any[]).map((r) => `#${r.name}`);
  const field = (f: string) => db.prepare("SELECT * FROM field_values WHERE object_id = ? AND field = ?").get(c.id, f) as any | undefined;
  const block = db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY CASE origin WHEN 'owner' THEN 0 ELSE 1 END, position LIMIT 1").get(c.id) as any;
  // The gist is what the Object itself says: the owner's words first, then the start of the extract (the item's own text), then anything else.
  const extract = field("captured");
  const other = block || extract ? null : (db.prepare("SELECT * FROM field_values WHERE object_id = ? AND field NOT IN ('extraction', 'title') ORDER BY CASE origin WHEN 'ai' THEN 1 ELSE 0 END LIMIT 1").get(c.id) as any);
  const piece = block ? { text: cleanText(db, block.text), origin: block.origin } : extract ? { text: String(extract.value), origin: extract.origin } : other ? { text: String(other.value), origin: other.origin } : null;
  const gist = piece && piece.text ? ` — ${piece.origin === "owner" ? "owner" : piece.origin === "source" ? "source" : "AI"}: ${piece.text.replace(/\s+/g, " ").slice(0, 260)}` : "";
  const by = field("authors")?.value ? ` by ${String(field("authors").value).slice(0, 60)}` : "";
  return `${c.ref} [${o.type}] "${titleOf(db, c.id).slice(0, 100)}"${by}${tags.length ? ` ${tags.slice(0, 6).join(" ")}` : ""}${gist}`;
}

/**
 * One Object, in full, with every piece labelled by its Origin. AI Notes are never included: an earlier answer is not evidence.
 * The short facts and Connections come first so a long extract never crowds them out; the extract then takes the largest share
 * of what is left (the start and the end are kept when it is too long).
 */
export function fullObject(db: Db, ref: string, id: string, cap: number): string {
  const o = live(db, id)!;
  const head: string[] = [`[${ref}] ${o.type}: "${titleOf(db, id)}"`];
  const long: { label: string; text: string; weight: number }[] = [];
  const fields = db.prepare("SELECT * FROM field_values WHERE object_id = ? AND field NOT IN ('extraction', 'title')").all(id) as any[];
  for (const f of fields) {
    if (f.field === "captured") long.push({ label: `the extract, the item's own text (${labelOf(f)})`, text: String(f.value), weight: 3 });
    else head.push(`${f.field} (${labelOf(f)}): ${String(f.value).slice(0, 800)}`);
  }
  const comment = commentForAi(db, id); // the owner's phone-capture comment, only ever shown inside its Source (issue #63)
  if (comment) head.push(`Comment sent with it (the owner's words): ${cleanText(db, comment).slice(0, 3000)}`);
  const tags = (db.prepare("SELECT t.name, ot.origin FROM object_tags ot JOIN tags t ON t.id = ot.tag_id WHERE ot.object_id = ?").all(id) as any[]);
  if (tags.length) head.push(`Tags: ${tags.map((t) => `${t.name}${t.origin === "ai" ? " (AI)" : ""}`).join(", ")}`);
  // Connections to other readable Objects, by title and kind (never to a Private one).
  const conns = (db.prepare("SELECT * FROM connections WHERE from_id = ? OR to_id = ?").all(id, id) as any[])
    .flatMap((c) => { const other = c.from_id === id ? c.to_id : c.from_id; return readable(db, other) ? [`"${titleOf(db, other)}" (${c.kind})`] : []; }).slice(0, 12);
  if (conns.length) head.push(`Connected to: ${conns.join("; ")}`);
  for (const b of db.prepare("SELECT * FROM blocks WHERE object_id = ? ORDER BY position").all(id) as any[]) {
    const text = cleanText(db, b.text);
    if (text) long.push({ label: labelOf(b), text, weight: 1 });
  }
  const used = head.join("\n").length;
  const room = Math.max(600, cap - used - 20 * (long.length + 1));
  const total = long.reduce((n, p) => n + p.weight, 0) || 1;
  const parts = long.map((p) => `- (${p.label}) ${clip(p.text, Math.max(300, Math.floor((room * p.weight) / total)))}`);
  return [...head, ...(parts.length ? ["Text:", ...parts] : [])].join("\n");
}

const hasOwnerText = (db: Db, ids: string[]) =>
  ids.some((id) => db.prepare("SELECT 1 FROM blocks WHERE object_id = ? AND origin = 'owner' AND length(trim(text)) > 0 UNION ALL SELECT 1 FROM field_values WHERE object_id = ? AND origin = 'owner' AND field <> 'title' LIMIT 1").get(id, id));

/** Private Objects whose words match the question, counted here. Only a number leaves this function. */
export function privateMatches(db: Db, scope: string | null, question: string): number {
  const terms = termsOf(question);
  if (!terms.length) return 0;
  const need = Math.min(2, terms.length);
  const rows = (db.prepare("SELECT id FROM objects WHERE deleted_at IS NULL AND private = 1").all() as any[]).map((r) => r.id as string);
  const near = scope
    ? new Set((db.prepare("SELECT from_id, to_id FROM connections WHERE from_id = ? OR to_id = ?").all(scope, scope) as any[]).map((c) => (c.from_id === scope ? c.to_id : c.from_id) as string))
    : null;
  return rows.filter((id) => (!near || near.has(id)) && terms.filter((t) => rawText(db, id).toLowerCase().includes(t)).length >= need).length;
}
export const privateLine = (n: number) =>
  n <= 0 ? null : n === 1 ? "1 Private Object matches this. The Researcher didn't read it." : `${n} Private Objects match this. The Researcher didn't read them.`;

// ---------- Prompts ----------

const PICK_SYSTEM = `You are the Researcher in a personal knowledge Garden. The owner asked a question. Below are short index cards of the Objects you may read.
Choose the Objects you need to read in full to answer well. Each card shows the start of the item's own text, so judge by what it says, not only the title. Prefer the Objects whose content really bears on the question, including ones that disagree with each other. Answer with ONE JSON object and nothing else: {"read": ["o1", "o4"]}
Rules:
- Use only refs from the list (like "o3"). At most ${MAX_READ}. Use [] if none are needed. Never invent a ref.
- Each card says where its one-line gist came from: owner (the owner's own words), source (captured from outside) or AI (written by AI, which is never evidence).`;

const ANSWER_SYSTEM = `You are the Researcher in a personal knowledge Garden: the owner's analytical sparring partner. Your job is to help them think better, not to summarise. Work ONLY from the Objects under "Objects you read". Read the extracts and the owner's words closely; do not rely on titles.
Rules:
- Every piece of text is labelled with its Origin. "The owner's words" are the owner's own. "From the Source" was captured from outside and is NOT the owner's view. "Written by AI" is never evidence. The extract is the item's own text.
- Say "you wrote", "you said" or "your view" ONLY about text labelled "the owner's words". For Source text say "the Source says". If nothing is the owner's, do not claim the owner thinks anything.
- An earlier question or answer from this Inquiry (if shown) is only there so you understand a follow-up. It is NOT evidence: never cite it or build on it.
- Put the ref in square brackets, like [o2], right after each claim it supports. Use only refs shown under "Objects you read". Say clearly which statements come from the Garden and which are your own inference ("My inference:").
- Structure the answer as short plain paragraphs, in this order, leaving out a paragraph only if it has nothing real to say:
  1. The big picture: the direct answer in two or three sentences, where this sits and why it matters.
  2. The thread: what connects the Objects you read, with the specifics (claims, figures, arguments) from their text, each with its ref.
  3. Tension: where the Objects disagree, or where one Source's argument is weak, rests on an assumption, or the owner's own words pull against a Source. Name the kind of disagreement: a direct contradiction, a difference of context, time or method, or a different reading of the same evidence. Do not invent a disagreement.
  4. What the Garden does not establish: the missing evidence or the gap, stated plainly. Never fill a gap with outside facts.
  5. One question worth asking next, starting "A question to take further:".
- If the owner is stating a view or testing an idea, challenge it: say what supports it in the Objects and what would count against it. Be direct, not contrarian.
- If the Objects don't contain the answer, say so plainly and say what is missing. Never invent facts or use knowledge from outside the Objects.
- Length: as long as the answer deserves, usually 250 to 500 words.
- Format in Markdown, but light, so it reads as thinking and not as a report: start each of the five parts with a short bold lead-in (for example **The big picture.**), **bold** only for the few key terms, a short "- " bullet list when you set out two or more specifics or claims (each with its ref), and "> " for a short phrase quoted from the text, with its ref after it. No headings with #, no tables, no HTML, no links to the web. Separate paragraphs and lists with a blank line.
- "connections" lists up to 3 pairs of Objects you read that clearly relate. "kind" is one of: related, supports, contradicts, builds on. Use [] if none.
Answer with ONE JSON object and nothing else: {"answer": string, "connections": [{"a": "o1", "b": "o2", "kind": "supports"}]}`;

// ---------- The two requests ----------

type Ctx = { gate: Gate; now: Date; countCall: () => void };
type Called<T> = { value: T; model: string } | Outcome;
const isOutcome = (x: any): x is Outcome => x === "done" || x === "skip" || (typeof x === "object" && x !== null && !("value" in x));

/** Ask the models in order until one gives something usable. */
async function request<T>(ctx: Ctx, messages: any[], parse: (text: string) => T | null): Promise<Called<T>> {
  let sawBusy = false;
  for (const model of AI_CONFIG.models) {
    let text: string;
    try { ctx.countCall(); text = await ctx.gate.chat(model, messages); }
    catch (e) {
      if (!(e instanceof GateError)) throw e;
      if (e.kind === "daily") return { daily: true, resetAt: e.resetAt };
      if (e.kind === "key" || e.kind === "missing") return { key: true };
      if (e.kind === "busy") sawBusy = true;
      continue;
    }
    const value = parse(text);
    if (value !== null) return { value, model };
  }
  return sawBusy ? { busy: true } : { unusable: true };
}

const setSteps = (db: Db, turnId: number, labels: string[], done: number) =>
  db.prepare("UPDATE inquiry_turns SET steps = ? WHERE id = ?").run(JSON.stringify(labels.map((label, i) => ({ label, done: i < done }))), turnId);

export async function researcherHandler(db: Db, job: { id: number; turn_id?: number | null }, ctx: Ctx): Promise<Outcome> {
  const turn = job.turn_id ? (db.prepare("SELECT * FROM inquiry_turns WHERE id = ?").get(job.turn_id) as any) : undefined;
  if (!turn || turn.answer) return "skip";
  const inq = db.prepare("SELECT * FROM inquiries WHERE id = ? AND deleted_at IS NULL").get(turn.inquiry_id) as any;
  if (!inq) return "skip";
  const stop = (why: string): Outcome => { db.prepare("UPDATE inquiry_turns SET error = ? WHERE id = ?").run(why, turn.id); return "skip"; };
  if (inq.object_id && !readable(db, inq.object_id)) return stop("This Object is Private or gone, so the Researcher didn't read it.");

  // 1. Index cards, then ask which Objects are needed. (A retry after a busy answer skips this request: the choice is kept.)
  const cards: Card[] = candidateIds(db, inq.object_id, turn.question).map((id, i) => ({ ref: `o${i + 1}`, id }));
  const labels = [`Looking through ${cards.length} index ${cards.length === 1 ? "card" : "cards"}`, "Choosing what to read", "Reading them in full", "Writing the answer", "Checking the links"];
  let picked: string[];
  if (turn.picked !== null && turn.picked !== undefined) picked = JSON.parse(turn.picked);
  else if (!cards.length) picked = [];
  else {
    setSteps(db, turn.id, labels, 1);
    const prompt = `Question (the owner's words): ${turn.question}\n${inq.object_id ? `The owner is looking at "${titleOf(db, inq.object_id)}"; its connected and related Objects are listed.\n` : "The whole Garden is open to you.\n"}\nIndex cards:\n${cards.map((c) => cardLine(db, c)).join("\n")}`;
    const r = await request(ctx, [{ role: "system", content: PICK_SYSTEM }, { role: "user", content: prompt }], (text) => {
      const j = jsonOf(text);
      if (!j || !Array.isArray(j.read)) return null;
      const byRef = new Map(cards.map((c) => [c.ref, c.id]));
      return [...new Set((j.read as unknown[]).filter((x): x is string => typeof x === "string").map((x) => byRef.get(x.trim())).filter((x): x is string => !!x))].slice(0, MAX_READ);
    });
    if (isOutcome(r)) return r;
    picked = r.value;
    db.prepare("UPDATE inquiry_turns SET picked = ? WHERE id = ?").run(JSON.stringify(picked), turn.id);
  }
  if (!cards.length) db.prepare("UPDATE inquiry_turns SET picked = '[]' WHERE id = ?").run(turn.id);

  // 2. Read the chosen Objects in full (checked again now: Private or Bin Objects are dropped here) and answer.
  const toRead = [...(inq.object_id ? [inq.object_id as string] : []), ...picked].filter((id, i, a) => a.indexOf(id) === i && readable(db, id));
  // An Object keeps the ref it had on its index card (the Object being asked about is o0), so the two requests agree.
  const cardRef = new Map(cards.map((c) => [c.id, c.ref]));
  let extra = cards.length;
  const refOf = new Map(toRead.map((id) => [id === inq.object_id ? "o0" : (cardRef.get(id) ?? `o${++extra}`), id]));
  setSteps(db, turn.id, labels, 2);
  // The Object the owner is looking at counts double: it is what the question is about.
  const shares = toRead.reduce((n, id) => n + (id === inq.object_id ? 2 : 1), 0) || 1;
  const capOf = (id: string) => Math.floor((TEXT_BUDGET * (id === inq.object_id ? 2 : 1)) / shares);
  const earlier = (db.prepare("SELECT question, answer FROM inquiry_turns WHERE inquiry_id = ? AND id < ? ORDER BY id").all(turn.inquiry_id, turn.id) as any[]);
  let prompt = `Question (the owner's words): ${turn.question}\n\n`;
  if (earlier.length)
    prompt += `Earlier in this Inquiry (context for a follow-up only, NOT evidence):\n${earlier.map((e) => `- The owner asked: ${e.question}${e.answer ? `\n  An earlier AI answer (not evidence): ${cleanRefs(e.answer).slice(0, 600)}` : ""}`).join("\n")}\n\n`;
  prompt += toRead.length ? `Objects you read:\n\n${[...refOf].map(([ref, id]) => fullObject(db, ref, id, capOf(id))).join("\n\n")}` : "Objects you read: none. Say that nothing in the Garden covers this.";
  setSteps(db, turn.id, labels, 3);

  const r2 = await request(ctx, [{ role: "system", content: ANSWER_SYSTEM }, { role: "user", content: prompt }], (text) => {
    const j = jsonOf(text);
    const answer = typeof j?.answer === "string" ? j.answer.trim() : "";
    if (!answer || answer.length > 8000) return null;
    // The owner is only ever quoted when something the owner wrote was shown.
    if (!hasOwnerText(db, toRead) && /\byou (wrote|said|noted|argued|think|believe)\b|\byour (own )?(words|notes?|view)\b/i.test(answer)) return null;
    return { answer, connections: Array.isArray(j.connections) ? j.connections : [] };
  });
  if (isOutcome(r2)) return r2;

  // 3. Check the links: only refs of Objects it really read survive; every other link is dropped.
  setSteps(db, turn.id, labels, 4);
  const stillOk = (id: string) => readable(db, id);
  const text = linkRefs(r2.value.answer, new Map([...refOf].filter(([, id]) => stillOk(id))));
  const reads = toRead.filter(stillOk);
  const priv = privateMatches(db, inq.object_id, turn.question);
  const date = ctx.now.toISOString().slice(0, 10);
  const cancelled = (db.prepare("SELECT status FROM ai_jobs WHERE id = ?").get(job.id) as any)?.status === "cancelled";
  if (cancelled || !db.prepare("SELECT 1 FROM inquiries WHERE id = ? AND deleted_at IS NULL").get(turn.inquiry_id)) return "skip";
  db.transaction(() => {
    db.prepare("UPDATE inquiry_turns SET answer = ?, read_ids = ?, private_count = ?, error = NULL, ai_role = ?, ai_model = ?, ai_date = ? WHERE id = ?")
      .run(text, JSON.stringify(reads), priv, ROLE, r2.model, date, turn.id);
    setSteps(db, turn.id, labels, 5);
    suggestConnections(db, r2.value.connections, new Map([...refOf].filter(([, id]) => stillOk(id))), r2.model, ctx.now);
  })();
  return "done";
}

/** [o2] and [o1, o3] become Mentions of the real Objects they stand for; any other bracketed ref, or Mention, is removed. */
export function linkRefs(answer: string, refs: Map<string, string>): string {
  const ok = new Set(refs.values());
  return answer
    .replace(MENTION, (m, id: string) => (ok.has(id) ? m : ""))
    .replace(/\[(o\d+(?:\s*[,;]\s*o\d+)*)\]/g, (_m, list: string) =>
      list.split(/[,;]/).map((r) => refs.get(r.trim())).filter((id): id is string => !!id).map(mentionToken).join(" "))
    .replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
}
/** Plain text for the AI to understand a follow-up: links read as nothing. */
const cleanRefs = (s: string) => s.replace(MENTION, "").replace(/\s{2,}/g, " ").trim();

/** Connections the answer found become Suggestions on the first Object (never on a Thought, never twice, never turned-down ones). */
function suggestConnections(db: Db, raw: unknown[], refs: Map<string, string>, model: string, now: Date) {
  let made = 0;
  for (const c of raw as any[]) {
    if (made >= 3) break;
    const a = refs.get(String(c?.a ?? "").trim()), b = refs.get(String(c?.b ?? "").trim());
    const kind = typeof c?.kind === "string" ? c.kind.trim().toLowerCase() : "related";
    if (!a || !b || a === b || !KINDS.includes(kind)) continue;
    if (!readable(db, a) || !readable(db, b) || live(db, a).type === "thought" || live(db, b).type === "thought") continue;
    if (db.prepare("SELECT 1 FROM connections WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)").get(a, b, b, a)) continue;
    if (db.prepare("SELECT 1 FROM ai_rejected WHERE kind = 'connection' AND ((object_id = ? AND value = ?) OR (object_id = ? AND value = ?))").get(a, b, b, a)) continue;
    if (db.prepare("SELECT 1 FROM ai_suggestions WHERE kind = 'connection' AND ((object_id = ? AND json_extract(data, '$.otherId') = ?) OR (object_id = ? AND json_extract(data, '$.otherId') = ?))").get(a, b, b, a)) continue;
    db.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'connection', ?, ?, ?, ?, ?)")
      .run(a, JSON.stringify({ otherId: b, kind }), ROLE, model, now.toISOString().slice(0, 10), now.toISOString());
    made++;
  }
}

// ---------- Reading an answer (for the page) ----------

/** The text with links to Objects that are gone removed, and the Objects the remaining links point at. */
export function renderRefs(db: Db, text: string) {
  const links: Record<string, { type: string; title: string; private: boolean }> = {};
  const out = text.replace(MENTION, (_m, id: string) => {
    const b = brief(db, id);
    if (!b) return "";
    links[id] = { type: b.type, title: b.title, private: b.private };
    return mentionToken(id);
  }).replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { text: out, links };
}

const jobOf = (db: Db, turnId: number) => db.prepare("SELECT * FROM ai_jobs WHERE turn_id = ? ORDER BY id DESC LIMIT 1").get(turnId) as any | undefined;

function turnOut(db: Db, t: any, hasKey: boolean) {
  const job = jobOf(db, t.id);
  const state = (t.answer ? "done" : !job ? "cancelled" : job.status === "done" ? "failed" : job.status) as "waiting" | "working" | "busy" | "tomorrow" | "failed" | "cancelled" | "done";
  const steps = JSON.parse(t.steps) as { label: string; done: boolean }[];
  let answer = null;
  if (t.answer) {
    const { text, links } = renderRefs(db, t.answer);
    const reads = (JSON.parse(t.read_ids ?? "[]") as string[]).flatMap((id) => { const b = brief(db, id); return b ? [b] : []; });
    const kept = (db.prepare("SELECT object_id FROM ai_notes WHERE inquiry_id = ? AND kind = 'answer' AND text = ?").all(t.inquiry_id, t.answer) as any[])
      .flatMap((n) => { const b = brief(db, n.object_id); return b ? [b] : []; });
    answer = { text, links, reads, kept, model: t.ai_model as string, role: t.ai_role as string, date: t.ai_date as string, privateNote: privateLine(t.private_count ?? 0) };
  }
  return {
    id: t.id as number, question: t.question as string, state, steps, answer,
    error: (t.error as string | null) ?? (state === "failed" && job?.attempts >= AI_CONFIG.researcherBusyTries ? "The free AI stayed busy for about an hour, so this was not answered." : null),
    nextTryAt: state === "busy" || state === "tomorrow" ? (job.run_after as string) : undefined,
    tries: state === "busy" ? (job.attempts as number) : undefined, maxTries: AI_CONFIG.researcherBusyTries,
    needsKey: !t.answer && !hasKey && (state === "waiting" || state === "busy"),
  };
}

export function inquiryOf(db: Db, id: string, hasKey = true) {
  const i = db.prepare("SELECT * FROM inquiries WHERE id = ? AND deleted_at IS NULL").get(id) as any;
  if (!i) return null;
  const turns = (db.prepare("SELECT * FROM inquiry_turns WHERE inquiry_id = ? ORDER BY id").all(id) as any[]).map((t) => turnOut(db, t, hasKey));
  return { id: i.id as string, object: i.object_id ? brief(db, i.object_id) : null, scopeGone: !!i.object_id && !live(db, i.object_id), createdAt: i.created_at as string, turns };
}

/** Every Inquiry, newest first. `objectId` limits it to questions about one Object. */
export function listInquiries(db: Db, objectId?: string) {
  const rows = (objectId
    ? db.prepare("SELECT * FROM inquiries WHERE deleted_at IS NULL AND object_id = ? ORDER BY created_at DESC, rowid DESC").all(objectId)
    : db.prepare("SELECT * FROM inquiries WHERE deleted_at IS NULL ORDER BY created_at DESC, rowid DESC").all()) as any[];
  return rows.map((i) => {
    const turns = db.prepare("SELECT * FROM inquiry_turns WHERE inquiry_id = ? ORDER BY id").all(i.id) as any[];
    const last = turns[turns.length - 1];
    const state = last ? turnOut(db, last, true).state : "cancelled";
    return {
      id: i.id as string, question: (turns[0]?.question ?? "") as string, turns: turns.length, state, createdAt: i.created_at as string,
      object: i.object_id ? brief(db, i.object_id) : null, scopeGone: !!i.object_id && !live(db, i.object_id),
    };
  });
}

// ---------- Keeping an answer ----------

const turnWithAnswer = (db: Db, turnId: number) => db.prepare("SELECT t.*, i.object_id AS scope FROM inquiry_turns t JOIN inquiries i ON i.id = t.inquiry_id WHERE t.id = ? AND t.answer IS NOT NULL AND i.deleted_at IS NULL").get(turnId) as any | undefined;

/** "Keep on…": the answer becomes an AI Note on each chosen Object (never a Private one: no AI text is kept there). Returns the Objects it now sits on. */
export function keepAnswer(db: Db, turnId: number, objectIds: unknown) {
  const t = turnWithAnswer(db, turnId);
  if (!t) return null;
  if (!Array.isArray(objectIds) || !objectIds.length) throw new BadRequest("Pick at least one Object to keep it on");
  const ids = [...new Set(objectIds.filter((x): x is string => typeof x === "string"))].slice(0, 20);
  for (const id of ids) {
    const o = live(db, id);
    if (!o) throw new BadRequest("That Object could not be found");
    if (o.private) throw new BadRequest("A Private Object keeps no AI text, so an answer can't be kept on it");
  }
  const question = t.question as string;
  db.transaction(() => {
    for (const id of ids) {
      if (db.prepare("SELECT 1 FROM ai_notes WHERE object_id = ? AND inquiry_id = ? AND text = ?").get(id, t.inquiry_id, t.answer)) continue;
      db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at, inquiry_id, question) VALUES (?, 'answer', ?, ?, ?, ?, ?, ?, ?)")
        .run(id, t.answer, t.ai_role, t.ai_model, t.ai_date, new Date().toISOString(), t.inquiry_id, question);
    }
  })();
  return ids.map((id) => brief(db, id)!);
}

/** "Start a Thought from this": an empty Thought for the owner's words, the answer beside it as its prompt (still AI), and "inspired by" the Object asked about. */
export function thoughtFromTurn(db: Db, turnId: number) {
  const t = turnWithAnswer(db, turnId);
  if (!t) return null;
  return db.transaction(() => {
    const th = createObject(db, { type: "thought" });
    db.prepare("INSERT INTO ai_notes (object_id, kind, text, ai_role, ai_model, ai_date, created_at, inquiry_id, question) VALUES (?, 'prompt', ?, ?, ?, ?, ?, ?, ?)")
      .run(th.id, t.answer, t.ai_role, t.ai_model, t.ai_date, new Date().toISOString(), t.inquiry_id, t.question);
    if (t.scope && live(db, t.scope)) db.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'inspired by', 'owner')").run(th.id, t.scope);
    return th.id as string;
  })();
}

/** Where a kept answer came from: the question, and whether its Inquiry is still there, in the Bin, or gone. */
export function sourceOfNote(db: Db, n: { inquiry_id: string | null; question: string | null }) {
  if (!n.inquiry_id) return null;
  const i = db.prepare("SELECT deleted_at FROM inquiries WHERE id = ?").get(n.inquiry_id) as any;
  return { id: n.inquiry_id, question: n.question ?? "", state: (!i ? "gone" : i.deleted_at ? "bin" : "here") as "here" | "bin" | "gone" };
}

// ---------- Deleting (the Bin) ----------

/** Delete an Inquiry to the Bin. Answers already kept on Objects stay, and still point back to it. */
export function deleteInquiry(db: Db, id: string) {
  const r = db.prepare("UPDATE inquiries SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").run(id);
  if (!r.changes) return false;
  for (const t of db.prepare("SELECT id FROM inquiry_turns WHERE inquiry_id = ?").all(id) as any[]) cancelJobs(db, t.id);
  return true;
}
export const restoreInquiry = (db: Db, id: string) => db.prepare("UPDATE inquiries SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL").run(id).changes > 0;

export function purgeInquiries(db: Db, ids: string[]) {
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      if (!db.prepare("SELECT 1 FROM inquiries WHERE id = ? AND deleted_at IS NOT NULL").get(id)) continue;
      db.prepare("DELETE FROM ai_jobs WHERE turn_id IN (SELECT id FROM inquiry_turns WHERE inquiry_id = ?)").run(id);
      db.prepare("DELETE FROM inquiry_turns WHERE inquiry_id = ?").run(id);
      db.prepare("DELETE FROM inquiries WHERE id = ?").run(id); // kept answers keep their question text but no longer link
      n++;
    }
  })();
  return n;
}
export const emptyInquiryBin = (db: Db) => purgeInquiries(db, (db.prepare("SELECT id FROM inquiries WHERE deleted_at IS NOT NULL").all() as any[]).map((r) => r.id));
export const purgeExpiredInquiries = (db: Db) =>
  purgeInquiries(db, (db.prepare("SELECT id FROM inquiries WHERE deleted_at IS NOT NULL AND deleted_at <= datetime('now', '-30 days')").all() as any[]).map((r) => r.id));

export function listBinInquiries(db: Db) {
  return (db.prepare("SELECT * FROM inquiries WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").all() as any[]).map((i) => {
    const first = db.prepare("SELECT question FROM inquiry_turns WHERE inquiry_id = ? ORDER BY id LIMIT 1").get(i.id) as any;
    const days = Math.max(0, Math.ceil(30 - (Date.now() - Date.parse(iso(i.deleted_at)!)) / 864e5));
    return { id: i.id as string, question: (first?.question ?? "") as string, deletedAt: iso(i.deleted_at)!, daysLeft: days };
  });
}
