# Markdown in the editor and in everything the AI writes

A body is still a list of text blocks, but each block is now Markdown (a paragraph, `## a heading`, `- a` / `- b`, `1. a`, `> a quote`, a fenced code block, `---`, with `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` and `[links](https://…)` inside), with `[[o:id]]` where an Object is mentioned. No migration was needed: plain text with no marks is already valid Markdown, so everything written before stays exactly as it was. The owner asked for formatting in the editor and in what the Archivist and the Researcher write.

- **Editor** (`BodyEditor.tsx`): formatting works as you type (`# `, `- `, `1. `, `> `, `**bold**`, ⌘B / ⌘I), and each top-level block is saved back as Markdown. `src/shared/markdown-doc.ts` converts both ways with the `marked` parser. Plain text is only backslash-escaped where it would otherwise be read as formatting (a typed `*star*` or a line starting `# `), so ordinary words are saved as typed. A Mention cannot carry bold or italic.
- **Reading** (`Markdown.tsx`): AI Notes, Researcher answers and the Peek build React elements straight from the parsed tokens. No HTML is ever injected: raw HTML and images are shown as text, only http(s) and mailto links are links, and AI headings are drawn below the page's own headings.
- **AI writing**: the Researcher answers with light Markdown (a bold lead-in per part, short bullet lists, `>` for a quoted phrase, no `#` headings, tables or HTML). The Archivist's summary note holds a Markdown list of claims, each led by **Reported** or **Interpretation**.
- **One-line places** (titles from a body's first line, search snippets) strip the formatting with `plainOf`.

Origin is unchanged: the owner's blocks are still the owner's, and the AI's Markdown only ever lives in AI Notes and Inquiries.
