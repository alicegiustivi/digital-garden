// Export my Garden (issue #40, decided in #22). An Export is NOT a Backup (CONTEXT.md):
//  - a Backup is encrypted, automatic and the only way the Garden is put back;
//  - an Export is made by hand, readable without the Garden, NOT encrypted, and never used to restore.
//
// What the owner gets: one dated folder holding
//   Sources/ Concepts/ Thoughts/ People/   one Markdown file per Object (folder names come from the Object Types)
//   Inquiries/  Daily Inbox/                one file per Inquiry / per day
//   images/                                 the shrunk copies (no thumbnails, no originals exist)
//   Tags.md   Read me first.md
//   garden.json                             everything the Garden knows; wins if the files disagree
//
// Safety: everything is written into a hidden "unfinished" folder next to the final one and renamed only when every
// file is written. If anything stops it (an error, the Mac going to sleep and the Garden quitting), the unfinished folder
// is deleted and the Garden says "Export didn't finish". There is never a partial copy that looks complete.
// It reads only the Garden's own database and images: no network, no AI.
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type Database from "better-sqlite3";
import { BadRequest, titleOf } from "./objects.ts";
import { gardenDir, imagesDir } from "./paths.ts";
import { localDay } from "./inbox.ts";
import { MENTION } from "./mentions.ts";

type Db = Database.Database;

/** Bump when the shape of garden.json changes. Documented in docs/export.md. */
export const EXPORT_VERSION = 1;
export const exportStatePath = () => join(gardenDir(), "export-state.json");

// ---------------------------------------------------------------- small helpers

const ROLE: Record<string, string> = { archivist: "Archivist", researcher: "Researcher" };
const day10 = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : "");
/** "AI · Archivist · model · 2026-11-09": the same line the Garden shows. */
export const aiLine = (role: string | null, model: string | null, date: string | null) =>
  `AI · ${ROLE[role ?? ""] ?? role ?? "AI"} · ${model ?? "unknown model"} · ${day10(date)}`;

type Origin = { origin: string; aiRole: string | null; aiModel: string | null; aiDate: string | null; approved?: boolean };
const originOf = (r: any, approved?: boolean): Origin => ({ origin: r.origin, aiRole: r.ai_role ?? null, aiModel: r.ai_model ?? null, aiDate: r.ai_date ?? null, ...(approved === undefined ? {} : { approved: r.origin === "ai" && !!approved }) });
/** ✦ AI, ✧ approved AI, ❝ Source, the owner's words plain. */
const mark = (o: Origin) => (o.origin === "ai" ? (o.approved ? "✧" : "✦") : o.origin === "source" ? "❝" : "");
const withMark = (o: Origin, text: string) => (mark(o) ? `${mark(o)} ${text}` : text);
const aiTail = (o: Origin) => (o.origin === "ai" ? ` — ${aiLine(o.aiRole, o.aiModel, o.aiDate)}` : "");

/** Replace the characters a filename can't hold. The true title stays inside the file. */
export function safeName(title: string): string {
  let n = title.replace(/[\u0000-\u001f\u007f\/\\:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();
  if (n.length > 100) n = n.slice(0, 100).trim();
  return n || "Untitled";
}
/** Gives each name once per folder: a second "Attention" becomes "Attention (2)". macOS ignores upper/lower case, so so do we. */
function namer() {
  const taken = new Set<string>();
  return (title: string) => {
    const base = safeName(title);
    let name = base, i = 2;
    while (taken.has(name.toLowerCase())) name = `${base} (${i++})`;
    taken.add(name.toLowerCase());
    return name;
  };
}
const link = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const json = <T>(s: string | null | undefined, fallback: T): T => { try { return s ? JSON.parse(s) : fallback; } catch { return fallback; } };

// ---------------------------------------------------------------- gathering everything the Garden knows

export type ExportOptions = { leaveOutPrivate?: boolean };

/**
 * Reads the whole Garden into one plain object. It is what garden.json holds, and the Markdown is made from it.
 * With leaveOutPrivate, Private Objects are not read at all, and nothing that points at one is kept.
 */
export function gatherGarden(db: Db, opts: ExportOptions = {}, now = new Date()) {
  const out = !!opts.leaveOutPrivate;
  const all = (sql: string, ...args: any[]) => db.prepare(sql).all(...args) as any[];
  const objRows = all("SELECT * FROM objects WHERE deleted_at IS NULL ORDER BY created_at, id").filter((o) => !(out && o.private));
  const ids = new Set<string>(objRows.map((o) => o.id));
  const types = all("SELECT * FROM object_types ORDER BY position");
  const defs = new Map(all("SELECT * FROM field_definitions").map((d) => [d.key, d]));
  const typeFields = all("SELECT * FROM type_fields ORDER BY type, position");
  const tagRows = new Map(all("SELECT * FROM tags").map((t) => [t.id, t]));
  const by = <T extends { object_id: string }>(rows: T[]) => { const m = new Map<string, T[]>(); for (const r of rows) { (m.get(r.object_id) ?? m.set(r.object_id, []).get(r.object_id)!).push(r); } return m; };
  const fields = by(all("SELECT * FROM field_values ORDER BY id"));
  const objTags = by(all("SELECT * FROM object_tags"));
  const blocks = by(all("SELECT * FROM blocks ORDER BY object_id, position"));
  const images = new Map(all("SELECT * FROM source_images").map((i) => [i.object_id, i]));
  const questions = new Map(all("SELECT * FROM open_questions").map((q) => [q.object_id, q]));
  const versions = by(all("SELECT * FROM concept_versions ORDER BY object_id, day DESC"));
  const notes = by(all("SELECT * FROM ai_notes ORDER BY id"));
  const suggestions = by(all("SELECT * FROM ai_suggestions ORDER BY id"));
  const rejected = by(all("SELECT * FROM ai_rejected"));
  const runs = by(all("SELECT * FROM ai_runs ORDER BY id"));

  const objects = objRows.map((o) => {
    const img = images.get(o.id);
    const q = questions.get(o.id);
    return {
      id: o.id as string, type: o.type as string, title: o.title as string | null, displayTitle: titleOf(db, o.id),
      private: !!o.private, unreviewed: !!o.unreviewed, captured: !!o.captured,
      createdAt: o.created_at as string, updatedAt: (o.updated_at ?? null) as string | null,
      typeChangedByAi: json<any>(o.type_ai, null), aiReadBeforePrivate: o.private ? (o.ai_read_before_private ?? null) : null,
      fields: (fields.get(o.id) ?? []).map((f) => ({ field: f.field as string, value: f.value as string, ...originOf(f, f.approved) })),
      tags: (objTags.get(o.id) ?? []).filter((t) => tagRows.has(t.tag_id)).map((t) => ({ name: tagRows.get(t.tag_id).name as string, color: tagRows.get(t.tag_id).color as string, ...originOf(t, false) })),
      body: (blocks.get(o.id) ?? []).map((b) => ({ position: b.position as number, text: b.text as string, ...originOf(b) })),
      image: img ? { file: img.file as string, width: img.width as number | null, height: img.height as number | null } : null,
      openQuestion: q ? { openedAt: q.opened_at as string, settledAt: (q.settled_at ?? null) as string | null, settledBy: (q.settled_by ?? null) as string | null } : null,
      conceptVersions: (versions.get(o.id) ?? []).map((v) => ({ day: v.day as string, savedAt: v.saved_at as string, origin: "owner", paragraphs: json<string[]>(v.paragraphs, []) })),
      aiNotes: (notes.get(o.id) ?? []).map((n) => ({ id: n.id as number, kind: n.kind as string, text: n.text as string, origin: "ai", aiRole: n.ai_role as string, aiModel: n.ai_model as string, aiDate: n.ai_date as string, createdAt: n.created_at as string, inquiryId: (n.inquiry_id ?? null) as string | null, question: (n.question ?? null) as string | null })),
      pendingSuggestions: (suggestions.get(o.id) ?? []).map((s) => ({ id: s.id as number, kind: s.kind as string, data: json<any>(s.data, {}), origin: "ai", aiRole: s.ai_role as string, aiModel: s.ai_model as string, aiDate: s.ai_date as string, createdAt: s.created_at as string })).filter((s) => !(out && s.data?.otherId && !ids.has(s.data.otherId))),
      rejectedSuggestions: (rejected.get(o.id) ?? []).map((r) => ({ kind: r.kind as string, value: r.value as string })),
      editHistory: (runs.get(o.id) ?? []).map((r) => ({ runId: r.id as number, by: "AI · Archivist", model: r.model as string, at: r.created_at as string, undoneAt: (r.undone_at ?? null) as string | null, changes: json<any>(r.changes, []) })),
    };
  });
  // rejected Connection suggestions are stored as "the other Object's id"; with Private left out, drop the ones that name a left-out Object
  if (out) for (const o of objects) o.rejectedSuggestions = o.rejectedSuggestions.filter((r) => r.kind !== "connection" || ids.has(r.value));

  const connections = all("SELECT * FROM connections ORDER BY id")
    .filter((c) => ids.has(c.from_id) && ids.has(c.to_id))
    .map((c) => ({ id: c.id as number, from: c.from_id as string, to: c.to_id as string, kind: c.kind as string, note: (c.note ?? null) as string | null, createdAt: (c.created_at ?? null) as string | null, ...originOf(c, c.approved) }));

  // Tags: every Tag and how many of the exported Objects carry it. With Private left out, a Tag only a Private Object carried is not listed.
  const count = new Map<string, number>();
  for (const o of objects) for (const t of o.tags) count.set(t.name, (count.get(t.name) ?? 0) + 1);
  const tags = [...tagRows.values()].map((t) => ({ name: t.name as string, color: t.color as string, objects: count.get(t.name) ?? 0 })).filter((t) => !(out && t.objects === 0)).sort((a, b) => a.name.localeCompare(b.name));

  const inquiries = all("SELECT * FROM inquiries WHERE deleted_at IS NULL ORDER BY created_at, id")
    .filter((q) => !(out && q.object_id && !ids.has(q.object_id)))
    .map((q) => ({
      id: q.id as string, objectId: (q.object_id ?? null) as string | null, createdAt: q.created_at as string,
      turns: all("SELECT * FROM inquiry_turns WHERE inquiry_id = ? ORDER BY id", q.id).map((t) => ({
        question: t.question as string, questionOrigin: "owner", answer: (t.answer ?? null) as string | null,
        readObjectIds: json<string[]>(t.read_ids, []).filter((i) => !out || ids.has(i)), privateMatches: (t.private_count ?? null) as number | null,
        error: (t.error ?? null) as string | null, steps: json<any[]>(t.steps, []),
        aiRole: (t.ai_role ?? null) as string | null, aiModel: (t.ai_model ?? null) as string | null, aiDate: (t.ai_date ?? null) as string | null, createdAt: t.created_at as string,
      })),
    }));

  const captures = all("SELECT * FROM inbox_captures ORDER BY sent_at, id")
    .filter((c) => !(out && c.private))
    .map((c) => ({
      id: c.id as number, day: c.day as string, sentAt: c.sent_at as string, status: c.status as string, reason: (c.reason ?? null) as string | null,
      refused: !!c.refused, comment: (c.comment ?? null) as string | null, commentOrigin: "owner", private: !!c.private, thoughtId: (c.thought_id && (!out || ids.has(c.thought_id)) ? c.thought_id : null) as string | null,
      objectIds: all("SELECT object_id FROM inbox_objects WHERE capture_id = ? ORDER BY position", c.id).map((r) => r.object_id as string).filter((i) => ids.has(i)),
    }));

  return {
    format: "digital-garden-export", version: EXPORT_VERSION, exportedAt: now.toISOString(), leftOutPrivateObjects: out,
    note: "Not encrypted. This is a readable copy, not a Backup: it can't restore the Garden. If the readable files and this file disagree, this file wins.",
    origins: { owner: "the owner's own words", ai: "written by the AI (aiRole, aiModel, aiDate say which); approved:true means the owner approved it, it stays AI", source: "came from outside the Garden" },
    objectTypes: types.map((t) => ({ key: t.key as string, label: t.label as string, plural: t.plural as string, fields: typeFields.filter((f) => f.type === t.key).map((f) => ({ key: f.field as string, label: defs.get(f.field)?.label as string, input: defs.get(f.field)?.input as string, options: json<string[] | null>(defs.get(f.field)?.options, null), lead: !!f.lead })) })),
    objects, connections, tags, inquiries, dailyInbox: captures,
  };
}
export type Garden = ReturnType<typeof gatherGarden>;
type GObject = Garden["objects"][number];

// ---------------------------------------------------------------- the readable files

/** Works out every file's place first, so a Mention can link to a file that is written later. */
function layout(g: Garden) {
  const plural = new Map(g.objectTypes.map((t) => [t.key, t.plural]));
  const folders = new Map<string, (t: string) => string>();
  const nameIn = (folder: string, title: string) => { if (!folders.has(folder)) folders.set(folder, namer()); return folders.get(folder)!(title); };
  const objects = new Map<string, string>();
  for (const o of g.objects) { const f = plural.get(o.type) ?? o.type; objects.set(o.id, `${f}/${nameIn(f, o.displayTitle)}.md`); }
  const inquiries = new Map<string, string>();
  for (const q of g.inquiries) inquiries.set(q.id, `Inquiries/${nameIn("Inquiries", q.turns[0]?.question.slice(0, 60) || "Inquiry")}.md`);
  const days = new Map<string, string>();
  for (const d of new Set(g.dailyInbox.filter((c) => c.status === "done" || c.comment).map((c) => c.day))) days.set(d, `Daily Inbox/${safeName(d)}.md`);
  return { objects, inquiries, days };
}

const hhmm = (iso: string) => new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function markdownFor(g: Garden, L: ReturnType<typeof layout>, privateIds: Set<string>) {
  const byId = new Map(g.objects.map((o) => [o.id, o]));
  const typeOf = new Map(g.objectTypes.map((t) => [t.key, t]));
  const KIND: Record<string, [string, string]> = { related: ["related", "related"], supports: ["supports", "supported by"], contradicts: ["contradicts", "contradicts"], "builds on": ["builds on", "built on by"], "inspired by": ["inspired by", "inspired"], mentions: ["mentions", "mentioned by"], "authored by": ["authored by", "author of"] };

  /** A Mention becomes a link to the other Object's file. */
  const mentions = (text: string, from: string) =>
    text.replace(MENTION, (_m, id: string) => {
      const target = byId.get(id);
      if (target) return `[${target.displayTitle.replace(/[\[\]]/g, "")}](${rel(from, L.objects.get(id)!)})`;
      return privateIds.has(id) ? "[a Private Object]" : "[an Object that is no longer in the Garden]";
    });
  const rel = (from: string, to: string) => { const up = "../".repeat(from.split("/").length - 1); return up + link(to); };
  const bodyAt = (id: string) => L.objects.get(id)!;

  const objectFile = (o: GObject): string => {
    const here = bodyAt(o.id);
    const t = typeOf.get(o.type);
    const lines: string[] = [`# ${o.displayTitle}`, ""];
    const meta = [`**${t?.label ?? o.type}**`, `Created ${day10(o.createdAt)}`];
    if (o.updatedAt) meta.push(`Updated ${day10(o.updatedAt)}`);
    if (o.private) meta.push("**Private**");
    lines.push(meta.join(" · "), "");
    if (o.typeChangedByAi) lines.push(`✧ The type was changed by the ${aiLine(o.typeChangedByAi.aiRole ?? o.typeChangedByAi.role ?? null, o.typeChangedByAi.aiModel ?? o.typeChangedByAi.model ?? null, o.typeChangedByAi.aiDate ?? o.typeChangedByAi.date ?? null)} and you approved it.`, "");
    if (o.private && o.aiReadBeforePrivate) lines.push(`The AI read this before it became Private, on ${o.aiReadBeforePrivate}.`, "");
    if (o.openQuestion) lines.push(o.openQuestion.settledAt ? `**Open Question — settled for now** on ${day10(o.openQuestion.settledAt)}${o.openQuestion.settledBy && byId.get(o.openQuestion.settledBy) ? ` by [${byId.get(o.openQuestion.settledBy)!.displayTitle}](${rel(here, L.objects.get(o.openQuestion.settledBy)!)})` : ""}` : "**Open Question**", "");
    if (o.tags.length) lines.push("Tags: " + o.tags.map((tg) => withMark(tg, `#${tg.name}`)).join("  "), "");
    // fields: the type's fields in the Garden's order, then any value kept from an earlier type
    const defs = t?.fields ?? [];
    const order = [...defs.map((d) => d.key), ...o.fields.map((f) => f.field).filter((k) => k !== "title" && !defs.some((d) => d.key === k))]; // the title is the heading above
    const label = (k: string) => defs.find((d) => d.key === k)?.label ?? k;
    const lead: string[] = [];
    for (const k of order) {
      const f = o.fields.find((x) => x.field === k);
      if (!f) continue;
      if (defs.find((d) => d.key === k)?.lead) { lead.push(`**${label(k)}**\n\n${withMark(f, f.value)}${aiTail(f) ? `\n\n_${aiTail(f).slice(3)}_` : ""}`); continue; }
      lines.push(`- ${label(k)}: ${withMark(f, f.value)}${f.origin === "ai" ? ` _(${aiLine(f.aiRole, f.aiModel, f.aiDate)})_` : ""}`);
    }
    if (lines[lines.length - 1] !== "") lines.push("");
    for (const l of lead) lines.push(l, "");
    if (o.image) lines.push(`![${o.displayTitle.replace(/[\[\]]/g, "")}](${rel(here, "images/" + o.image.file)})`, "");
    // body
    for (const b of o.body) {
      const text = mentions(b.text, here);
      if (b.origin === "source") lines.push(text.split("\n").map((l, i) => `> ${i === 0 ? "❝ " : ""}${l}`).join("\n"), "");
      else if (b.origin === "ai") lines.push(withMark(b, text), "", `_${aiLine(b.aiRole, b.aiModel, b.aiDate)}_`, "");
      else lines.push(text, "");
    }
    // connections
    const cons = g.connections.filter((c) => c.from === o.id || c.to === o.id);
    if (cons.length) {
      lines.push("## Connections", "");
      for (const c of cons) {
        const subject = c.from === o.id, other = byId.get(subject ? c.to : c.from);
        if (!other) continue;
        const k = KIND[c.kind] ?? [c.kind, c.kind];
        lines.push(`- ${withMark(c, `${subject ? k[0] : k[1]} [${other.displayTitle.replace(/[\[\]]/g, "")}](${rel(here, L.objects.get(other.id)!)})`)}${c.note ? ` — ${c.note}` : ""}${aiTail(c)}`);
      }
      lines.push("");
    }
    // Concept: the view over time
    if (o.conceptVersions.length) {
      lines.push("## Your view over time", "");
      for (const v of o.conceptVersions) lines.push(`### ${v.day}`, "", v.paragraphs.map((p) => mentions(p, here)).join("\n\n"), "");
    }
    // from the AI
    const aiTags = o.tags.filter((tg) => tg.origin === "ai");
    if (o.aiNotes.length || aiTags.length) {
      lines.push("## From the AI", "");
      for (const n of o.aiNotes) lines.push(`✦ ${mentions(n.text, here).replace(/\n/g, "\n  ")}`, `  _${aiLine(n.aiRole, n.aiModel, n.aiDate)}${n.question ? ` · answering “${n.question}”` : ""}_`, "");
      for (const tg of aiTags) lines.push(`${mark(tg)} #${tg.name} _(${aiLine(tg.aiRole, tg.aiModel, tg.aiDate)})_`);
      if (aiTags.length) lines.push("");
    }
    if (o.pendingSuggestions.length) {
      lines.push("## Suggested (not approved)", "");
      for (const s of o.pendingSuggestions) {
        const d = s.data ?? {};
        const what = s.kind === "connection" ? `Connect to ${byId.get(d.otherId)?.displayTitle ?? "another Object"} (${d.kind ?? "related"})` : s.kind === "type" ? `Change the type to ${typeOf.get(d.type)?.label ?? d.type}` : s.kind === "object" ? `Add a new ${typeOf.get(d.type)?.label ?? d.type}: ${d.name}` : `Title: ${d.title}`;
        lines.push(`- ✦ ${what} _(${aiLine(s.aiRole, s.aiModel, s.aiDate)})_`);
      }
      lines.push("");
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
  };

  const inquiryFile = (q: Garden["inquiries"][number], path: string) => {
    const lines = [`# ${q.turns[0]?.question.slice(0, 80) || "Inquiry"}`, "", `Asked ${day10(q.createdAt)}${q.objectId && byId.get(q.objectId) ? ` about [${byId.get(q.objectId)!.displayTitle}](${rel(path, L.objects.get(q.objectId)!)})` : " of the whole Garden"}`, ""];
    for (const t of q.turns) {
      lines.push(`## ${t.question.replace(/\n/g, " ")}`, "", `_Your question, ${day10(t.createdAt)}_`, "");
      if (t.answer) lines.push(`✦ ${mentions(t.answer, path)}`, "", `_${aiLine(t.aiRole, t.aiModel, t.aiDate)}_`, "");
      else if (t.error) lines.push(`_No answer: ${t.error}_`, "");
      const read = t.readObjectIds.filter((i) => L.objects.has(i));
      if (read.length) lines.push("Read: " + read.map((i) => `[${byId.get(i)!.displayTitle.replace(/[\[\]]/g, "")}](${rel(path, L.objects.get(i)!)})`).join(", "), "");
    }
    return lines.join("\n").trimEnd() + "\n";
  };

  const dayFile = (day: string, path: string) => {
    const lines = [`# Daily Inbox ${day}`, ""];
    for (const c of g.dailyInbox.filter((c) => c.day === day && (c.status === "done" || c.comment))) {
      lines.push(`## ${hhmm(c.sentAt)}${c.private ? " · Private" : ""}`, "");
      if (c.comment) lines.push(c.comment, "");
      const made = c.objectIds.filter((i) => L.objects.has(i));
      if (made.length) lines.push("Made: " + made.map((i) => `[${byId.get(i)!.displayTitle.replace(/[\[\]]/g, "")}](${rel(path, L.objects.get(i)!)})`).join(", "), "");
      if (c.thoughtId && L.objects.has(c.thoughtId)) lines.push(`The comment became [a Thought](${rel(path, L.objects.get(c.thoughtId)!)}).`, "");
    }
    return lines.join("\n").trimEnd() + "\n";
  };

  const tagsFile = () => ["# Tags", "", ...g.tags.map((t) => `- #${t.name} — ${t.objects} ${t.objects === 1 ? "Object" : "Objects"}`), ""].join("\n");

  const readMe = () => `# Read me first

This folder is an **Export** of your Digital Garden, made ${day10(g.exportedAt)}. It is a readable copy you can open without the Garden. It is **not a Backup**: it can't put the Garden back. Backups (encrypted, in Google Drive) do that.

**This folder is not encrypted.** Anyone who can open it can read all of it${g.leftOutPrivateObjects ? ". Private Objects were left out of this one (and so were their Connections and Mentions)." : ", **including your Private Objects**, which are marked Private. Keep it somewhere safe."}

## What is in it
${g.objectTypes.map((t) => `- **${t.plural}/** — one file per ${t.label}, named by its title. Each shows its type, dates, Tags and fields, then the body, then its Connections.`).join("\n")}
- **Inquiries/** — one file per question you put to the Researcher, with its answers and the Objects it read.
- **Daily Inbox/** — one file per day of things you sent from your phone, with your comments.
- **images/** — the pictures (the shrunk copies the Garden keeps; there are no larger originals).
- **Tags.md** — every Tag and how many Objects carry it.
- **garden.json** — everything the Garden knows, for other programs. **If the readable files and garden.json ever disagree, garden.json is right.** It also holds things the files leave out: suggestions you turned down, the history of what the AI changed, Concept views, and captures that didn't arrive.

## The marks
- Plain text: your own words.
- ✦ written by the AI. ✧ suggested by the AI and approved by you (it stays the AI's).
- ❝ came from outside: a Source's text, a quote, details read from a page.
- Under each AI piece: "AI · role · model · date" says which AI role and model wrote it, and when.

Things you deleted (the Bin) are not in the Export.
`;

  return { objectFile, inquiryFile, dayFile, tagsFile, readMe };
}

// ---------------------------------------------------------------- writing the folder

export type ExportDeps = { now?: () => Date; /** Called before each file is written. Tests use it to stop an Export part-way. */ beforeFile?: (n: number, path: string) => void | Promise<void> };
export type ExportResult = { ok: boolean; path?: string; message: string; files?: number; objects?: number };
export type Progress = { done: number; total: number };

async function writeFolder(db: Db, tmp: string, opts: ExportOptions, deps: ExportDeps, onProgress: (p: Progress) => void) {
  const now = (deps.now ?? (() => new Date()))();
  const g = gatherGarden(db, opts, now);
  const L = layout(g);
  const leftOut = new Set<string>(opts.leaveOutPrivate ? (db.prepare("SELECT id FROM objects WHERE private = 1 AND deleted_at IS NULL").all() as any[]).map((r) => r.id) : []); // only the ids, to say "[a Private Object]"; their content is never read
  const M = markdownFor(g, L, leftOut);
  const imgs = g.objects.filter((o) => o.image);
  const total = g.objects.length + g.inquiries.length + L.days.size + imgs.length + 3;
  let n = 0;
  const step = async (path: string) => { await deps.beforeFile?.(n, path); onProgress({ done: ++n, total }); if (n % 20 === 0) await new Promise((r) => setImmediate(r)); }; // let the Garden answer the owner meanwhile
  const put = async (path: string, text: string) => { await step(path); const full = join(tmp, path); await mkdir(join(full, ".."), { recursive: true }); await writeFile(full, text); };
  for (const o of g.objects) await put(L.objects.get(o.id)!, M.objectFile(o));
  for (const q of g.inquiries) await put(L.inquiries.get(q.id)!, M.inquiryFile(q, L.inquiries.get(q.id)!));
  for (const [day, path] of L.days) await put(path, M.dayFile(day, path));
  let missing = 0;
  for (const o of imgs) {
    await step("images/" + o.image!.file);
    await mkdir(join(tmp, "images"), { recursive: true });
    try { await copyFile(join(imagesDir(), o.image!.file), join(tmp, "images", o.image!.file)); } catch { missing++; (o.image as any).missing = true; }
  }
  await put("Tags.md", M.tagsFile());
  await put("Read me first.md", M.readMe());
  const data = { ...g, files: { objects: Object.fromEntries(L.objects), inquiries: Object.fromEntries(L.inquiries), dailyInbox: Object.fromEntries(L.days) }, imagesMissing: missing };
  await put("garden.json", JSON.stringify(data, null, 2) + "\n");
  return { files: n, objects: g.objects.length };
}

type State = { running?: { tmp: string; startedAt: string }; last?: { ok: boolean; at: string; path?: string; leftOutPrivateObjects?: boolean; error?: string } };
const readState = (): State => { try { return JSON.parse(readFileSync(exportStatePath(), "utf8")); } catch { return {}; } };
const writeState = (s: State) => writeFileSync(exportStatePath(), JSON.stringify(s));

export const defaultExportFolder = () => join(homedir(), "Documents");
/** The folder to put the dated Export folder in: it must exist on this Mac. */
export function checkExportFolder(p: unknown): string {
  if (typeof p !== "string" || !p.trim()) throw new BadRequest("Choose where to save the Export");
  const f = p.trim().replace(/^~(?=\/|$)/, homedir());
  if (!existsSync(f) || !statSync(f).isDirectory()) throw new BadRequest("That folder isn't on this Mac. Check the path.");
  return f;
}

let job: { progress: Progress; promise: Promise<ExportResult> } | null = null;

/** Starts an Export and returns at once; the progress shows in exportStatus(). Only one runs at a time. */
export function startExport(db: Db, opts: ExportOptions & { folder: unknown }, deps: ExportDeps = {}): Promise<ExportResult> {
  if (job) throw new BadRequest("An Export is already running.");
  const folder = checkExportFolder(opts.folder);
  const now = (deps.now ?? (() => new Date()))();
  const base = `Garden export ${localDay(now)}`;
  const tmp = join(folder, `.${base} (unfinished)`);
  const progress: Progress = { done: 0, total: 0 };
  writeState({ ...readState(), running: { tmp, startedAt: now.toISOString() } });
  const promise = (async (): Promise<ExportResult> => {
    try {
      await rm(tmp, { recursive: true, force: true });
      await mkdir(tmp, { recursive: true });
      const r = await writeFolder(db, tmp, opts, deps, (p) => { progress.done = p.done; progress.total = p.total; });
      // never overwrite an earlier Export: "Garden export 2026-11-09 (2)"
      let final = join(folder, base), i = 2;
      while (existsSync(final)) final = join(folder, `${base} (${i++})`);
      await rename(tmp, final);
      writeState({ last: { ok: true, at: new Date().toISOString(), path: final, leftOutPrivateObjects: !!opts.leaveOutPrivate } });
      return { ok: true, path: final, message: "Done", ...r };
    } catch (e) {
      await rm(tmp, { recursive: true, force: true }).catch(() => {});
      writeState({ last: { ok: false, at: new Date().toISOString(), error: (e as Error).message } });
      return { ok: false, message: "Export didn't finish" };
    } finally { job = null; }
  })();
  job = { progress, promise };
  return promise;
}

/** If the Garden was stopped in the middle of an Export (Mac asleep, quit), delete the half-written folder and remember it didn't finish. */
export async function cleanUpUnfinished() {
  const s = readState();
  if (!s.running || job) return;
  await rm(s.running.tmp, { recursive: true, force: true }).catch(() => {});
  writeState({ last: { ok: false, at: new Date().toISOString(), error: "The Garden stopped before the Export was done" } });
}

export function exportStatus() {
  const s = readState();
  if (job) return { state: "running" as const, progress: job.progress, line: job.progress.total ? `Exporting… ${job.progress.done} of ${job.progress.total} files` : "Exporting…", defaultFolder: defaultExportFolder() };
  const l = s.last;
  return {
    state: !l ? ("idle" as const) : l.ok ? ("done" as const) : ("failed" as const), progress: null,
    line: !l ? "" : l.ok ? "Done" : "Export didn't finish",
    path: l?.ok ? (l.path ?? null) : null, leftOutPrivateObjects: !!l?.leftOutPrivateObjects, detail: l && !l.ok ? (l.error ?? null) : null, at: l?.at ?? null,
    defaultFolder: defaultExportFolder(),
  };
}

/** A native Finder window to choose the folder. Returns null if the owner cancels. */
export const chooseFolder = () => new Promise<string | null>((resolve) => {
  execFile("osascript", ["-e", 'POSIX path of (choose folder with prompt "Where should the Export go?" default location (path to documents folder))'], { timeout: 10 * 60_000 }, (err, stdout) => resolve(err ? null : stdout.trim().replace(/\/$/, "") || null));
});
export const revealInFinder = (path: string) => { execFile("open", ["-R", path], () => {}); };
export const exportRunning = () => !!job;
export async function awaitExport() { return job?.promise; }
