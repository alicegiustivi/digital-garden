# Export my Garden

An **Export** is a readable copy of the Garden, made when you ask (More ▸ **Export**). It is **not a Backup**: a Backup is encrypted and is the only way the Garden is put back; an Export is **not encrypted**, can be read without the Garden, and is never used to restore it. It works offline and uses no AI.

You choose where it goes (Documents by default) and it makes a new folder there, `Garden export 2026-11-09` (a second one the same day gets `(2)`; an earlier Export is never overwritten). **"Leave out Private Objects"** (off by default) leaves out Private Objects, their Connections and their Mentions (Mentions read "[a Private Object]"). The screen says plainly that the folder is not encrypted. When it ends it says **Done** with **Show in Finder**. If it is stopped (disk full, Garden quit, Mac asleep), the half-written folder is deleted and the Garden says **Export didn't finish**.

## What is in the folder
| | |
|---|---|
| `Sources/ Concepts/ Thoughts/ People/` | one Markdown file per Object, named by title. Type, dates, Private mark, Open Question state, Tags and fields at the top, then the body, Connections, "Your view over time" (Concepts), "From the AI", "Suggested (not approved)". Same title twice → `Title (2).md`; characters a filename can't hold (`/ \ : * ? " < > |`) become `-` (the true title stays inside the file); an untitled Thought is named by its first line. |
| `Inquiries/` | one file per Inquiry: each question, answer, "AI · Researcher · model · date", and the Objects it read |
| `Daily Inbox/` | one file per day: your comments and links to what each message made |
| `images/` | the shrunk copies (no thumbnails) |
| `Tags.md` | every Tag and how many Objects carry it |
| `Read me first.md` | the folders and marks in plain words |
| `garden.json` | everything the Garden knows. **If the files and `garden.json` disagree, `garden.json` is right.** |

Marks: your words plain · ✦ AI · ✧ AI, approved by you (stays the AI's) · ❝ Source. Each AI piece has a line `AI · Archivist · model · 2026-11-02`.

Left out: anything in the Bin (Objects, Inquiries, Connections to them). Only in `garden.json`: rejected Suggestions, what the AI changed ("edit history"), failed captures, Concept versions' full data, steps and errors of Inquiries. (Concept versions and pending Suggestions are also in the Markdown.)

## `garden.json` layout (version 1)
Dates are ISO text; every piece of content carries `origin` (`owner` | `ai` | `source`), and AI pieces also `aiRole`, `aiModel`, `aiDate` (and `approved` where the owner can approve).
```
{
  format: "digital-garden-export", version: 1, exportedAt, leftOutPrivateObjects, note, origins,
  objectTypes: [{ key, label, plural, fields: [{ key, label, input, options, lead }] }],
  objects: [{
    id, type, title (null if untitled), displayTitle, private, unreviewed, captured, createdAt, updatedAt,
    typeChangedByAi, aiReadBeforePrivate,
    fields:   [{ field, value, origin, aiRole, aiModel, aiDate, approved }],
    tags:     [{ name, color, origin, aiRole, aiModel, aiDate }],
    body:     [{ position, text, origin, aiRole, aiModel, aiDate }],   // "[[o:<id>]]" is a Mention of that Object
    image:    { file, width, height, missing? } | null,                // file is in images/
    openQuestion: { openedAt, settledAt, settledBy } | null,
    conceptVersions: [{ day, savedAt, origin, paragraphs }],           // newest first
    aiNotes: [{ id, kind, text, origin, aiRole, aiModel, aiDate, createdAt, inquiryId, question }],
    pendingSuggestions:  [{ id, kind, data, origin, aiRole, aiModel, aiDate, createdAt }],
    rejectedSuggestions: [{ kind, value }],                            // kind "tag" = tag name; "connection" = other Object's id
    editHistory: [{ runId, by, model, at, undoneAt, changes }]         // what each Archivist run set, and what was there before
  }],
  connections: [{ id, from, to, kind, note, createdAt, origin, aiRole, aiModel, aiDate, approved }],
  tags: [{ name, color, objects }],
  inquiries: [{ id, objectId, createdAt, turns: [{ question, questionOrigin, answer, readObjectIds, privateMatches, error, steps, aiRole, aiModel, aiDate, createdAt }] }],
  dailyInbox: [{ id, day, sentAt, status: "done" | "failed", reason, refused, comment, commentOrigin, private, thoughtId, objectIds }],
  files: { objects: { id: path }, inquiries: { id: path }, dailyInbox: { day: path } },   // where each readable file is
  imagesMissing
}
```
The Garden keeps no per-edit history of titles and fields beyond this; `editHistory` is what the Archivist changed and could undo.
