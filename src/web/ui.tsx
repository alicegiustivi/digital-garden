import { Children, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Field, OriginInfo, Summary, Tag } from "./api";
import { displayTitle, fieldOf, type Types } from "./api";
import { typeColourCss } from "../shared/palette";

import { ICON } from "./icons";
import { STAGES } from "../shared/palette";

// Each Object Type's icon, set from the data whenever the types load (applyTypes), so <Icon name={o.type} /> works for a type the owner made.
let typeIcons: Record<string, string> = {};

/** One icon family for the whole Garden (see icons.ts). Decorative: the button or link around it carries the name. */
export function Icon({ name }: { name: string }) {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[typeIcons[name] ?? name] ?? "" }} />;
}

/**
 * Makes the types on screen match the data (issue #107): each type's colour, light and dark, becomes `--t-<key>` in a style
 * element (so typeVar() needs no CSS edit for a new type), and each type's icon is remembered for <Icon>. The colours in
 * style.css are only what shows for a moment before the first answer.
 */
export function applyTypes(t: Types) {
  typeIcons = Object.fromEntries(t.types.map((x) => [x.key, x.icon]));
  let el = document.getElementById("type-colours");
  if (!el) { el = document.createElement("style"); el.id = "type-colours"; document.head.appendChild(el); }
  el.textContent = typeColourCss(t.types);
}

export const typeVar = (type: string) => ({ ["--c" as string]: `var(--t-${type})`, ["--ct" as string]: `var(--tt-${type})`, ["--cf" as string]: `var(--tf-${type})` }) as React.CSSProperties;
export const tagVar = (color: string) => ({ ["--c" as string]: `var(--g-${color})` }) as React.CSSProperties;

export function TypeChip({ type, label, sub }: { type: string; label: string; sub?: string }) {
  return (
    <span className="chip" style={typeVar(type)}>
      <Icon name={type} />
      {label}
      {sub ? ` · ${sub}` : ""}
    </span>
  );
}

/** What hovering an Origin mark says. */
export function originTip(o: OriginInfo): string | undefined {
  if (o.origin === "ai" && o.approved) return `Suggested by the ${o.aiRole}, using ${o.aiModel}, on ${o.aiDate}. You approved it; it stays the AI's`;
  if (o.origin === "ai") return `Added by the ${o.aiRole}, using ${o.aiModel}, on ${o.aiDate}`;
  if (o.origin === "source") return "From the Source: it came from outside the Garden";
  return undefined;
}

/**
 * Origin marks (ADR 0001, issue #8). Owner: plain. AI: ✦ and a dotted underline (✧ once the owner approved it).
 * Source: italics and ❝. Drawn with glyphs and lines only, never colour (see .o-ai / .o-src in style.css).
 */
export function Marked({ o, children, className = "" }: { o: OriginInfo; children: ReactNode; className?: string }) {
  const cls = o.origin === "ai" ? (o.approved ? "o-ai approved" : "o-ai") : o.origin === "source" ? "o-src" : "";
  return (
    <span className={`${cls} ${className}`.trim()} title={originTip(o)}>
      {children}
    </span>
  );
}

export function TagPill({ tag, onRemove, linked }: { tag: Tag; onRemove?: () => void; linked?: boolean }) {
  return (
    <span className="tag" style={tagVar(tag.color)}>
      {linked
        ? <a className="tag-link" href={`#/tags/${encodeURIComponent(tag.name)}`} title={`See everything tagged #${tag.name}`}><Marked o={tag}>#{tag.name}</Marked></a>
        : <Marked o={tag}>#{tag.name}</Marked>}
      {onRemove && (
        <button className="x" onClick={onRemove} aria-label={`Remove tag ${tag.name}`}>
          <Icon name="close" />
        </button>
      )}
    </span>
  );
}

export const formatDay = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function subOf(o: Summary): string | undefined {
  const f: Field | undefined = fieldOf(o, o.type === "source" ? "format" : o.type === "thought" ? "kind" : STAGES[o.type]?.field ?? "");
  return f ? f.value[0].toUpperCase() + f.value.slice(1) : undefined;
}

export { displayTitle };

/** A Person's Portrait as a round photo, or a neutral placeholder in the Person colour (issue #69). */
export function Portrait({ stem, size, name, full }: { stem?: string | null; size: number; name?: string; full?: boolean }) {
  const px = { width: size, height: size } as React.CSSProperties;
  return stem
    ? <img className="portrait" style={px} src={`/api/portraits/${stem}/${full ? "full" : "thumb"}`} alt={name ? `Portrait of ${name}` : "Portrait"} />
    : <span className="portrait ph" style={{ ...px, ["--c" as string]: "var(--t-person)" }} aria-hidden="true"><span style={{ width: size * 0.56, height: size * 0.56 }}><Icon name="person" /></span></span>;
}

/** A one-line hint with the long explanation behind a fold ("How this works"). Used wherever a page used to open with a wall of grey text. */
export function Hint({ short, children }: { short: ReactNode; children?: ReactNode }) {
  return (
    <div className="hint">
      <p className="quiet">{short}</p>
      {children && <details className="how"><summary>How this works</summary><div className="how-body">{children}</div></details>}
    </div>
  );
}

/** Cards in newspaper columns: as many columns as fit, every column starts at the very top, and the next card goes under the shortest one. */
export function Stories({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setCols(Math.max(1, Math.floor((el.clientWidth + 32) / (250 + 32))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const items = Children.toArray(children);
  const lanes: ReactNode[][] = Array.from({ length: cols }, () => []);
  items.forEach((c, i) => lanes[i % cols].push(c));
  return (
    <div className="stories" ref={box}>
      {lanes.map((l, i) => <div className="stories-col" key={i}>{l}</div>)}
    </div>
  );
}
