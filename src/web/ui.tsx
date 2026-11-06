import type { ReactNode } from "react";
import type { Field, OriginInfo, Summary, Tag } from "./api";
import { displayTitle, fieldOf } from "./api";

/* The Garden's own icons, one per Object Type (from the approved "Issue" prototype). */
const ICON: Record<string, string> = {
  source: '<path d="M2 3.5h4.2A1.8 1.8 0 0 1 8 5.3v8.2a1.6 1.6 0 0 0-1.6-1.6H2zM14 3.5H9.8A1.8 1.8 0 0 0 8 5.3v8.2a1.6 1.6 0 0 1 1.6-1.6H14z"/>',
  concept: '<circle cx="3.6" cy="4.4" r="1.4"/><circle cx="12.4" cy="5" r="1.4"/><circle cx="7.6" cy="12.2" r="1.4"/><path d="M5 4.5l6 .4M4.3 5.7l2.6 5.2M11.7 6.3l-3.2 4.8"/>',
  thought: '<path d="M8 2.2c3.3 2.2 4.4 5.4 2.4 8.6C9.3 12.6 8 13.8 8 13.8s-1.3-1.2-2.4-3C3.6 7.6 4.7 4.4 8 2.2z"/><path d="M8 13.8V7"/>',
  person: '<circle cx="8" cy="5.4" r="2.6"/><path d="M3 14c.8-3 2.7-4.6 5-4.6s4.2 1.6 5 4.6"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  lock: '<rect x="3.5" y="7" width="9" height="6.5" rx="1.8"/><path d="M5.5 7V5.5a2.5 2.5 0 0 1 5 0V7"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  left: '<path d="M10 3L5 8l5 5"/>',
  right: '<path d="M6 3l5 5-5 5"/>',
  chevron: '<path d="M4 6l4 4 4-4"/>',
  expand: '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/>',
  link: '<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L8.5 4M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5L7.5 12"/>',
};
export function Icon({ name }: { name: string }) {
  return <svg className="ic" viewBox="0 0 16 16" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICON[name] ?? "" }} />;
}

export const typeVar = (type: string) => ({ ["--c" as string]: `var(--t-${type})` }) as React.CSSProperties;
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
  if (o.origin === "ai") return `Added by the ${o.aiRole}, using ${o.aiModel}, on ${o.aiDate}`;
  if (o.origin === "source") return "From the Source: it came from outside the Garden";
  return undefined;
}

/**
 * Origin marks (ADR 0001, issue #8). Owner: plain. AI: ✦ and a dotted underline.
 * Source: italics and ❝. Drawn with glyphs and lines only, never colour (see .o-ai / .o-src in style.css).
 */
export function Marked({ o, children, className = "" }: { o: OriginInfo; children: ReactNode; className?: string }) {
  const cls = o.origin === "ai" ? "o-ai" : o.origin === "source" ? "o-src" : "";
  return (
    <span className={`${cls} ${className}`.trim()} title={originTip(o)}>
      {children}
    </span>
  );
}

export function TagPill({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <span className="tag" style={tagVar(tag.color)}>
      <Marked o={tag}>#{tag.name}</Marked>
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
  const f: Field | undefined = fieldOf(o, o.type === "source" ? "format" : o.type === "thought" ? "kind" : "");
  return f ? f.value[0].toUpperCase() + f.value.slice(1) : undefined;
}

export { displayTitle };
