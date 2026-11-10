// Reading Markdown (AI Notes, Researcher answers, a Peek). The same parser as the editor (src/shared/markdown-doc.ts).
// It builds React elements straight from the parsed tokens and never injects HTML, so nothing an AI writes can run or load anything:
// raw HTML is shown as text, images are shown as their description, and only http(s) and mailto links are links.
import { Fragment, type ReactNode } from "react";
import type { Token } from "marked";
import { lex } from "../shared/markdown-doc";

const MENTION = /(\[\[o:[0-9a-f-]{36}\]\])/g;
const ID = /^\[\[o:([0-9a-f-]{36})\]\]$/;
const safe = (href: string) => /^(https?:|mailto:)/i.test(href);

type Mention = (id: string, key: string) => ReactNode;

function withMentions(text: string, mention: Mention, key: string): ReactNode[] {
  return text.split(MENTION).map((part, i) => {
    const m = part.match(ID);
    return m ? mention(m[1], `${key}.${i}`) : <Fragment key={`${key}.${i}`}>{part}</Fragment>;
  });
}

function inline(tokens: Token[] | undefined, mention: Mention, key: string): ReactNode[] {
  return (tokens ?? []).map((t: any, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "escape": return <Fragment key={k}>{String(t.raw).slice(1)}</Fragment>;
      case "strong": return <strong key={k}>{inline(t.tokens, mention, k)}</strong>;
      case "em": return <em key={k}>{inline(t.tokens, mention, k)}</em>;
      case "del": return <del key={k}>{inline(t.tokens, mention, k)}</del>;
      case "codespan": return <code key={k}>{String(t.raw).replace(/^`+/, "").replace(/`+$/, "")}</code>;
      case "br": return <br key={k} />;
      case "link":
        return safe(t.href)
          ? <a key={k} href={t.href} target="_blank" rel="noopener noreferrer">{inline(t.tokens, mention, k)}</a>
          : <Fragment key={k}>{inline(t.tokens, mention, k)}</Fragment>;
      default: return <Fragment key={k}>{withMentions(String(t.raw ?? t.text ?? ""), mention, k)}</Fragment>; // text, raw HTML, an image: shown as written
    }
  });
}

function blocks(tokens: Token[], mention: Mention, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  tokens.forEach((t: any, i) => {
    const k = `${key}.${i}`;
    switch (t.type) {
      case "space": break;
      case "paragraph": out.push(<p key={k}>{inline(t.tokens, mention, k)}</p>); break;
      case "text": out.push(<Fragment key={k}>{t.tokens ? inline(t.tokens, mention, k) : withMentions(String(t.raw), mention, k)}</Fragment>); break; // a tight list item's own words
      case "heading": { const H = (`h${Math.min(t.depth + 2, 5)}`) as "h3" | "h4" | "h5"; out.push(<H key={k}>{inline(t.tokens, mention, k)}</H>); break; } // below the page's own headings
      case "list": {
        const items = (t.items as any[]).map((it, j) => <li key={`${k}.${j}`}>{blocks(it.tokens ?? [], mention, `${k}.${j}`)}</li>);
        out.push(t.ordered ? <ol key={k} start={Number(t.start) || 1}>{items}</ol> : <ul key={k}>{items}</ul>);
        break;
      }
      case "blockquote": out.push(<blockquote key={k}>{blocks(t.tokens, mention, k)}</blockquote>); break;
      case "code": out.push(<pre key={k}><code>{String(t.text)}</code></pre>); break;
      case "hr": out.push(<hr key={k} />); break;
      default: if (String(t.raw ?? "").trim()) out.push(<p key={k}>{withMentions(String(t.raw).trim(), mention, k)}</p>); // a table or raw HTML: shown as written
    }
  });
  return out;
}

/** Markdown text as read-only content. `mention` draws each [[o:id]]. */
export function Markdown({ text, mention }: { text: string; mention: Mention }) {
  return <div className="md">{blocks(lex(text), mention, "m")}</div>;
}
