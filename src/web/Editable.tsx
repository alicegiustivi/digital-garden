import { useEffect, useRef, useState } from "react";
import type { OriginInfo } from "./api";
import { Marked } from "./ui";

type Props = {
  value: string;
  placeholder: string;
  origin?: OriginInfo;
  multiline?: boolean;
  /** For a choice field: the allowed values. */
  options?: string[] | null;
  startEditing?: boolean;
  className?: string;
  onSave: (value: string) => void;
};

/** Text that reads as plain text until clicked, then edits in place. Saving happens on Enter or when you click away. */
export function Editable({ value, placeholder, origin, multiline, options, startEditing, className = "", onSave }: Props) {
  const [editing, setEditing] = useState(!!startEditing);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement & HTMLSelectElement>(null);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (!editing) return;
    ref.current?.focus();
    if (options) try { (ref.current as any)?.showPicker?.(); } catch {}
    if (ref.current && "setSelectionRange" in ref.current && !options) ref.current.setSelectionRange(draft.length, draft.length);
  }, [editing]);
  useEffect(() => {
    // Long text grows with what's typed.
    const el = ref.current;
    if (editing && multiline && el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  }, [draft, editing, multiline]);

  const finish = (save: boolean, next = draft) => {
    setEditing(false);
    if (save && next !== value) onSave(next);
    else setDraft(value);
  };

  if (editing && options) {
    return (
      <select ref={ref} className={`edit ${className}`} value={draft} onChange={(e) => finish(true, e.target.value)} onBlur={() => finish(false)}>
        <option value="">(none)</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (editing) {
    const common = {
      ref: ref as any,
      className: `edit ${className}`,
      value: draft,
      placeholder,
      onChange: (e: React.ChangeEvent<any>) => setDraft(e.target.value),
      onBlur: () => finish(true),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.stopPropagation(); finish(false); }
        else if (e.key === "Enter" && (!multiline || !e.shiftKey)) { e.preventDefault(); finish(true); }
      },
    };
    return multiline ? <textarea rows={1} {...common} /> : <input type="text" size={Math.max(draft.length, placeholder.length, 4)} {...common} />;
  }
  const shown = value ? (origin ? <Marked o={origin}>{value}</Marked> : value) : <span className="ph">{placeholder}</span>;
  return (
    <>
      <span
        role="button"
        tabIndex={0}
        className={`view ${value ? "" : "empty"} ${className}`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setEditing(true))}
      >
        {shown}
      </span>
      {value && origin?.origin === "source" && origin.sourceUrl && (
        <a className="src-link small" href={origin.sourceUrl} target="_blank" rel="noreferrer noopener" title={`Looked up${origin.sourceDate ? ` on ${origin.sourceDate}` : ""}. Edit the value and it becomes yours.`}>↗ {origin.sourceName ?? "source"}</a>
      )}
    </>
  );
}
