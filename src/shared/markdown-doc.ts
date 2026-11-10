// Markdown in the Garden. A body is a list of text blocks; each block is Markdown (a paragraph, "## a heading", "- a\n- b" a list,
// "> a quote", and so on) with [[o:<id>]] where an Object is mentioned. Plain text with no marks is already valid Markdown, so
// everything written before this stays exactly as it was.
//
// This file turns Markdown into the editor's document and back (and is plain TypeScript, so it is tested without a browser).
// The reading side for AI Notes and Peeks is in Markdown.tsx; both use the same parser (marked), so they agree.
import { Lexer, type Token } from "marked";

type Mark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = { type: string; attrs?: Record<string, unknown>; content?: DocNode[]; text?: string; marks?: Mark[] };

const MENTION = /\[\[o:([0-9a-f-]{36})\]\]/g;
const MAX_HEADING = 4;

export const lex = (md: string): Token[] => new Lexer({ gfm: true, breaks: false }).lex(md);

// ---------- Markdown → editor document ----------

function textNodes(text: string, marks: Mark[]): DocNode[] {
  const out: DocNode[] = [];
  let at = 0;
  const push = (s: string) => { if (s) out.push({ type: "text", text: s, ...(marks.length ? { marks } : {}) }); };
  for (const m of text.matchAll(MENTION)) {
    push(text.slice(at, m.index));
    out.push({ type: "mention", attrs: { id: m[1] } });
    at = m.index! + m[0].length;
  }
  push(text.slice(at));
  return out;
}

function inline(tokens: Token[] | undefined, marks: Mark[] = []): DocNode[] {
  const out: DocNode[] = [];
  for (const t of tokens ?? []) {
    const x = t as any;
    switch (t.type) {
      case "escape": out.push(...textNodes(String(x.raw).slice(1), marks)); break;
      case "strong": out.push(...inline(x.tokens, [...marks, { type: "bold" }])); break;
      case "em": out.push(...inline(x.tokens, [...marks, { type: "italic" }])); break;
      case "del": out.push(...inline(x.tokens, [...marks, { type: "strike" }])); break;
      case "codespan": {
        const code = String(x.raw).replace(/^`+/, "").replace(/`+$/, "").replace(/^ (.*) $/s, "$1");
        if (code) out.push({ type: "text", text: code, marks: [...marks, { type: "code" }] });
        break;
      }
      case "link": out.push(...inline(x.tokens, [...marks, { type: "link", attrs: { href: x.href } }])); break;
      case "br": out.push({ type: "hardBreak" }); break;
      default: out.push(...textNodes(String(x.raw ?? x.text ?? ""), marks)); // text, html, image, anything unknown: shown as typed
    }
  }
  return out;
}

const paragraph = (tokens: Token[] | undefined): DocNode => {
  const content = inline(tokens);
  return content.length ? { type: "paragraph", content } : { type: "paragraph" };
};

function blocks(tokens: Token[]): DocNode[] {
  const out: DocNode[] = [];
  for (const t of tokens) {
    const x = t as any;
    switch (t.type) {
      case "space": break;
      case "paragraph": case "text": out.push(paragraph(x.tokens ?? [{ type: "text", raw: x.raw, text: x.text } as Token])); break;
      case "heading": out.push({ type: "heading", attrs: { level: Math.min(x.depth, MAX_HEADING) }, content: inline(x.tokens) }); break;
      case "list":
        out.push({
          type: x.ordered ? "orderedList" : "bulletList",
          ...(x.ordered ? { attrs: { start: Number(x.start) || 1 } } : {}),
          content: (x.items as any[]).map((i) => ({ type: "listItem", content: listItem(i) })),
        });
        break;
      case "blockquote": out.push({ type: "blockquote", content: blocks(x.tokens).length ? blocks(x.tokens) : [{ type: "paragraph" }] }); break;
      case "code": out.push({ type: "codeBlock", attrs: { language: x.lang || null }, ...(x.text ? { content: [{ type: "text", text: String(x.text) }] } : {}) }); break;
      case "hr": out.push({ type: "horizontalRule" }); break;
      default: { const raw = String(x.raw ?? "").trim(); if (raw) out.push({ type: "paragraph", content: textNodes(raw, []) }); } // a table or raw HTML: kept as typed text
    }
  }
  return out;
}
const listItem = (item: any): DocNode[] => {
  const inner = blocks(item.tokens ?? []);
  return inner.length ? inner : [{ type: "paragraph" }];
};

/** The stored blocks as an editor document. */
export function toDoc(markdownBlocks: string[]): DocNode {
  const content = markdownBlocks.flatMap((b) => (b.trim() ? blocks(lex(b)) : [{ type: "paragraph" } as DocNode]));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// ---------- Editor document → Markdown ----------

/** Plain text, escaped only where Markdown would otherwise read it as formatting, so ordinary words are saved exactly as typed. */
function escapeText(s: string): string {
  return s
    .replace(/\\(?=[\\`*_{}[\]()#+\-.!~>|<])/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/(?<!\s)\*|\*(?!\s)/g, "\\*")
    .replace(/(?<![\p{L}\p{N}\s])_(?=\S)|(?<=\S)_(?![\p{L}\p{N}\s])|^_|_$/gu, "\\_")
    .replace(/~~/g, "\\~\\~")
    .replace(/\[(?=[^\]\n]*\]\()/g, "\\[")
    .replace(/\[\[(?=o:[0-9a-f-]{36}\]\])/g, "\\[\\[");
}

/** A fence of backticks longer than any run inside the code, at least `min` long. */
const fenceFor = (code: string, min = 1) => "`".repeat(Math.max(min, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));

function markedText(n: DocNode): string {
  const marks = n.marks ?? [];
  const has = (t: string) => marks.find((m) => m.type === t);
  const raw = n.text ?? "";
  const [, lead, core, trail] = raw.match(/^(\s*)([\s\S]*?)(\s*)$/)!;
  if (!core) return raw;
  let s: string;
  if (has("code")) { const f = fenceFor(core); s = `${f}${/^`|`$/.test(core) ? ` ${core} ` : core}${f}`; }
  else s = escapeText(core);
  if (has("italic")) s = `*${s}*`;
  if (has("bold")) s = `**${s}**`;
  if (has("strike")) s = `~~${s}~~`;
  const link = has("link");
  if (link && link.attrs?.href) s = `[${s}](${String(link.attrs.href).replace(/\)/g, "%29").replace(/ /g, "%20")})`;
  return lead + s + trail;
}

function inlineMd(content: DocNode[] | undefined): string {
  let out = "";
  for (const n of content ?? []) {
    if (n.type === "mention") out += `[[o:${n.attrs?.id}]]`;
    else if (n.type === "hardBreak") out += "\\\n";
    else if (n.type === "text") out += markedText(n);
  }
  return out;
}

/** A paragraph that begins with something Markdown would read as a block ("# ", "- ", "1. ", ">") is protected with a backslash. */
const protect = (s: string) => s.replace(/^(#{1,6}(?=\s|$)|[>+\-](?=\s|$)|-{3,}\s*$|={3,}\s*$)/, "\\$1").replace(/^(\d+)([.)])(?=\s|$)/, "$1\\$2");

function indent(text: string, pad: string, first: string): string {
  return text.split("\n").map((l, i) => (i === 0 ? first + l : l ? pad + l : l)).join("\n");
}

function blockMd(n: DocNode): string {
  switch (n.type) {
    case "paragraph": return protect(inlineMd(n.content));
    case "heading": return `${"#".repeat(Math.min(Number(n.attrs?.level) || 1, 6))} ${inlineMd(n.content)}`;
    case "bulletList": return (n.content ?? []).map((li) => indent(itemMd(li), "  ", "- ")).join("\n");
    case "orderedList": {
      const start = Number(n.attrs?.start) || 1;
      return (n.content ?? []).map((li, i) => { const m = `${start + i}. `; return indent(itemMd(li), " ".repeat(m.length), m); }).join("\n");
    }
    case "blockquote": return (n.content ?? []).map(blockMd).join("\n\n").split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
    case "codeBlock": { const code = (n.content ?? []).map((c) => c.text ?? "").join(""); const f = fenceFor(code, 3); return `${f}${n.attrs?.language ?? ""}\n${code}\n${f}`; }
    case "horizontalRule": return "---";
    default: return inlineMd(n.content);
  }
}
const itemMd = (li: DocNode): string => {
  const kids = li.content ?? [];
  return kids.map((k, i) => (i === 0 ? blockMd(k) : (k.type === "bulletList" || k.type === "orderedList" ? "\n" : "\n\n") + blockMd(k))).join("");
};

/** The editor's document as stored blocks: one string for each top-level block. */
export function fromDoc(doc: DocNode): string[] {
  return (doc.content ?? []).map(blockMd);
}

/** The words of a block with the formatting taken away, for places that show a single plain line (titles, snippets). */
export function plainOf(md: string): string {
  const text = (tokens: Token[] | undefined): string =>
    (tokens ?? []).map((t: any) => (t.type === "br" ? " " : t.tokens ? text(t.tokens) : t.type === "escape" ? String(t.raw).slice(1) : t.type === "codespan" ? String(t.raw).replace(/`/g, "") : String(t.raw ?? t.text ?? ""))).join("");
  const walk = (tokens: Token[]): string[] =>
    tokens.flatMap((t: any): string[] => {
      if (t.type === "space" || t.type === "hr") return [];
      if (t.type === "list") return t.items.flatMap((i: any) => walk(i.tokens ?? []));
      if (t.type === "blockquote") return walk(t.tokens);
      if (t.type === "code") return [String(t.text)];
      if (t.tokens) return [text(t.tokens)];
      return [String(t.text ?? t.raw ?? "")];
    });
  return walk(lex(md)).join(" ").replace(/\s+/g, " ").trim();
}
