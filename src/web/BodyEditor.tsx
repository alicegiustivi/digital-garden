import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { api, type Found, type MentionInfo, type Types } from "./api";
import { MentionContext, MentionNode, type Controller } from "./Mention";
import { Icon, typeVar } from "./ui";

const TOKEN = /\[\[o:([0-9a-f-]{36})\]\]/g;

/** A stored paragraph (words, with [[o:id]] where an Object is mentioned) as an editor paragraph. */
const toParagraph = (t: string) => {
  const content: any[] = [];
  let at = 0;
  for (const m of t.matchAll(TOKEN)) {
    if (m.index! > at) content.push({ type: "text", text: t.slice(at, m.index) });
    content.push({ type: "mention", attrs: { id: m[1] } });
    at = m.index! + m[0].length;
  }
  if (at < t.length) content.push({ type: "text", text: t.slice(at) });
  return { type: "paragraph", content };
};
const toDoc = (paragraphs: string[]) => ({ type: "doc", content: (paragraphs.length ? paragraphs : [""]).map(toParagraph) });

type Picking = { query: string; command: (p: { id: string }) => void; rect: DOMRect | null; close: () => void };

/**
 * The owner's body. Plain paragraphs and Mentions; everything typed here is saved with Origin "owner".
 * Type @ or [[ to mention another Object by name (with an Object Type filter).
 */
export function BodyEditor({ paragraphs, placeholder, autofocus, selfId, types, info, open, onSave }: {
  paragraphs: string[]; placeholder: string; autofocus?: boolean; selfId: string; types: Types;
  info: Record<string, MentionInfo>; open: (id: string, beside: boolean) => void; onSave: (p: string[]) => void;
}) {
  const timer = useRef<number>(undefined);
  const pending = useRef<string[] | null>(null);
  const save = useRef(onSave);
  save.current = onSave;
  const [picking, setPicking] = useState<Picking | null>(null);
  const [extra, setExtra] = useState<Record<string, MentionInfo>>({});
  const controller = useRef<Controller | null>(null);
  const pickingNow = useRef<Picking | null>(null);
  pickingNow.current = picking;
  const live = useRef<{ picking: Picking | null; pick: (f: Found | undefined) => void; move: (d: number) => void; cycle: () => void }>(null as any);

  const flush = () => {
    window.clearTimeout(timer.current);
    if (pending.current) { save.current(pending.current); pending.current = null; }
  };

  const extensions = useMemo(
    () => [
      // Paragraphs and Mentions: that's all the Garden stores in a body in this build.
      StarterKit.configure({
        heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false,
        codeBlock: false, code: false, bold: false, italic: false, strike: false, underline: false, link: false,
        horizontalRule: false, hardBreak: false,
      }),
      Placeholder.configure({ placeholder }),
      MentionNode.configure({ controller: () => controller.current }),
    ],
    [],
  );

  const editor = useEditor({
    extensions,
    content: toDoc(paragraphs),
    autofocus: autofocus ? "end" : false,
    editorProps: { attributes: { "aria-label": "Your words", spellcheck: "true" } },
    onUpdate: ({ editor }) => {
      const next: string[] = [];
      editor.state.doc.forEach((p) => {
        let s = "";
        p.forEach((c) => { s += c.type.name === "mention" ? `[[o:${c.attrs.id}]]` : c.text ?? ""; });
        next.push(s);
      });
      pending.current = next;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 600);
    },
    onBlur: () => { flush(); },
  });

  // The picker is driven by the @ / [[ plugin through this controller.
  controller.current = {
    start: (p, close) => setPicking({ query: p.query, command: p.command, rect: p.clientRect?.() ?? null, close }),
    update: (p) => setPicking((s) => (s ? { ...s, query: p.query, command: p.command, rect: p.clientRect?.() ?? s.rect } : s)),
    key: (e) => {
      if (!pickingNow.current || !live.current) return false;
      if (e.key === "ArrowDown") { live.current.move(1); return true; }
      if (e.key === "ArrowUp") { live.current.move(-1); return true; }
      if (e.key === "Tab") { live.current.cycle(); return true; }
      if (e.key === "Enter") { live.current.pick(undefined); return true; }
      if (e.key === "Escape") { pickingNow.current.close(); return true; }
      return false;
    },
    exit: () => setPicking(null),
  };

  useEffect(() => () => flush(), []);
  const ctx = useMemo(
    () => ({ info: { ...info, ...extra }, typeLabel: (t: string) => types.types.find((x) => x.key === t)?.label ?? t, open }),
    [info, extra, types, open],
  );

  return (
    <MentionContext.Provider value={ctx}>
      <EditorContent editor={editor} className="body-editor" />
      {picking && (
        <MentionPicker
          picking={picking}
          types={types}
          selfId={selfId}
          live={live}
          onPick={(f) => {
            setExtra((x) => ({ ...x, [f.id]: { id: f.id, missing: false, type: f.type, title: f.title, private: f.private, tags: f.tags, connectionCount: f.connectionCount, kind: null, label: null } }));
            picking.command({ id: f.id });
          }}
        />
      )}
    </MentionContext.Provider>
  );
}

/** The name search under the cursor: arrows and Enter pick, Tab changes the Object Type filter, Esc closes. */
function MentionPicker({ picking, types, selfId, live, onPick }: {
  picking: Picking; types: Types; selfId: string; live: React.RefObject<any>; onPick: (f: Found) => void;
}) {
  const [type, setType] = useState("");
  const [rows, setRows] = useState<Found[]>([]);
  const [at, setAt] = useState(0);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    let stale = false;
    api.search({ q: picking.query, type, exclude: selfId, limit: 8 }).then((r) => { if (!stale) { setRows(r); setAt(0); setAsked(true); } });
    return () => { stale = true; };
  }, [picking.query, type, selfId]);
  const chips = ["", ...types.types.map((t) => t.key)];
  live.current = {
    picking,
    pick: (f: Found | undefined) => { const r = f ?? rows[at]; if (r) onPick(r); else picking.close(); },
    move: (d: number) => setAt((i) => (rows.length ? (i + d + rows.length) % rows.length : 0)),
    cycle: () => setType((t) => chips[(chips.indexOf(t) + 1) % chips.length]),
  };
  const r = picking.rect;
  const style: React.CSSProperties = r ? { left: Math.min(r.left, window.innerWidth - 340), top: r.bottom + 6 } : { left: 24, top: 120 };
  return (
    <div className="mention-pick" style={style} role="listbox" aria-label="Mention an Object" onMouseDown={(e) => e.preventDefault()}>
      <div className="mp-chips">
        {chips.map((k) => (
          <button key={k || "all"} className={type === k ? "on" : ""} style={k ? typeVar(k) : undefined} onClick={() => setType(k)}>
            {k ? <><Icon name={k} />{types.types.find((t) => t.key === k)!.label}</> : "All"}
          </button>
        ))}
      </div>
      {rows.map((f, i) => (
        <button key={f.id} role="option" aria-selected={i === at} className={`mp-row ${i === at ? "on" : ""}`} style={typeVar(f.type)} onMouseEnter={() => setAt(i)} onClick={() => onPick(f)}>
          <Icon name={f.type} />
          <span className="mp-t">{f.title}</span>
          {f.private && <Icon name="lock" />}
          <span className="mp-k">{types.types.find((t) => t.key === f.type)?.label}</span>
        </button>
      ))}
      {asked && !rows.length && <p className="mp-none">Nothing is called that{type ? " in this type" : ""}.</p>}
      <p className="mp-hint">↑↓ choose · ⏎ mention · Tab type · Esc close</p>
    </div>
  );
}
