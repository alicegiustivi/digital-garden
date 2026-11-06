// The Capture window (issues #21, #23, #27): one box for words, links and pictures, a "Will save as…" line,
// and Private beside Save ⌘↩. Links and pictures are lifted out of the words into small cards.
import { useEffect, useRef, useState } from "react";
import { api, type CaptureResult } from "./api";
import { Icon, TypeChip } from "./ui";

export type Attached = { file: File; src: string };
export type CaptureDraft = {
  text: string; links: string[]; images: Attached[]; priv: boolean;
  saved: { openId: string; what: string } | null;
  from: string | null; // set when opened from the "Save to Garden" bookmark
};
export const emptyDraft: CaptureDraft = { text: "", links: [], images: [], priv: false, saved: null, from: null };

/** ⌘N is kept by the browser for "new window" in an ordinary tab; an installed web-app window may let it through. */
export const standalone = () => window.matchMedia("(display-mode: standalone)").matches;
export const captureKey = () => (standalone() ? "⌘N" : "⌥⌘N");

/** True for the keys that open Capture: ⌘N, the fallback ⌥⌘N, and plain N when not typing. */
export function isCaptureKey(e: KeyboardEvent): boolean {
  const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");
  if (e.code === "KeyN" && e.metaKey && !e.ctrlKey && !e.shiftKey) return true;
  return e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;
const host = (u: string) => u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
const kb = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Moves links out of the words. While typing, a link moves once a space or new line follows it; a paste moves all. */
export function liftLinks(d: CaptureDraft, all: boolean): CaptureDraft {
  const re = all ? URL_RE : /\bhttps?:\/\/[^\s<>"]+(?=\s)/gi;
  const found = d.text.match(re);
  if (!found) return d;
  const links = [...d.links];
  for (const u of found) { const c = u.replace(/[.,;:!?)\]]+$/, ""); if (!links.includes(c)) links.push(c); }
  const text = d.text.replace(re, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+/, "");
  return { ...d, text, links };
}

function willSave(d: CaptureDraft) {
  const words = d.text.trim().length > 0, n = d.links.length + d.images.length;
  if (!words && !n) return null;
  const priv = d.priv && <span className="cw-priv"><Icon name="lock" /> Private</span>;
  if (!n) return <>Will save as <TypeChip type="thought" label="Thought" />{priv}</>;
  if (n === 1) return <>Will save as <TypeChip type="source" label="Source" sub={d.images.length ? "Image" : "Link"} />{words && " with your words as its body"}{priv}</>;
  return <>Will save as {n}× <TypeChip type="source" label="Source" />{words && <> and <TypeChip type="thought" label="Thought" /> with your words, mentioning them all</>}{priv}</>;
}

function describe(r: CaptureResult, priv: boolean, words: boolean) {
  const sources = [...r.created, ...r.existing].filter((o) => o.type === "source").length;
  let what = !sources ? "a Thought" : sources === 1 ? `a Source${words && r.created.length ? " with your words" : ""}` : `${sources} Sources${r.thoughtId ? " and a Thought" : ""}`;
  if (r.existing.length && r.created.length) what += ` (${r.existing.length} already in your Garden)`;
  return what + (priv ? " · Private" : "");
}

export function Capture({ draft, setDraft, onClose, onSaved, onOpen }: {
  draft: CaptureDraft; setDraft: (d: CaptureDraft) => void; onClose: () => void; onSaved: () => void; onOpen: (id: string) => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const has = draft.text.trim().length > 0 || draft.links.length > 0 || draft.images.length > 0;
  const can = has && !busy;

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "auto";
    ta.current.style.height = Math.min(ta.current.scrollHeight, window.innerHeight * 0.4) + "px";
  }, [draft.text]);

  const addImages = (files: File[]) => {
    const pics = files.filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!pics.length) return;
    setDraft({ ...draft, saved: null, images: [...draft.images, ...pics.map((file) => ({ file, src: URL.createObjectURL(file) }))] });
  };

  const save = async () => {
    if (!can) return;
    setBusy(true); setError(null);
    try {
      const words = draft.text.trim().length > 0;
      const r = await api.capture({ text: draft.text, links: draft.links, images: draft.images.map((i) => i.file), private: draft.priv });
      draft.images.forEach((i) => URL.revokeObjectURL(i.src));
      onSaved();
      if (!r.created.length) { setDraft({ ...emptyDraft }); onOpen(r.openId); return; } // already saved: open the existing Source
      // The box clears and Private switches itself off after every save.
      setDraft({ ...emptyDraft, saved: { openId: r.openId, what: describe(r, draft.priv, words) } });
      ta.current?.focus();
    } catch (e) {
      setError((e as Error).message || "Couldn't save. Everything is still here.");
    } finally { setBusy(false); }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
  };

  return (
    <div className="scrim cap-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div className="cw" role="dialog" aria-label="Capture">
        <div className="cw-top"><b>Capture</b><span>Esc closes</span></div>
        {draft.from && <div className="cw-from">Opened from <b>Save to Garden</b> in your browser · {draft.from}</div>}
        <div
          className={`cw-box ${drag ? "drag" : ""}`}
          onDragEnter={(e) => { e.preventDefault(); setDrag(true); }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault(); setDrag(false);
            const files = [...e.dataTransfer.files];
            if (files.length) return addImages(files);
            const u = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text");
            if (u) setDraft(liftLinks({ ...draft, text: draft.text + (draft.text ? "\n" : "") + u, saved: null }, true));
          }}
        >
          <textarea
            ref={ta}
            aria-label="Capture"
            placeholder="Type a thought, paste a link, or drop an image…"
            value={draft.text}
            onChange={(e) => setDraft(liftLinks({ ...draft, text: e.target.value, saved: null }, false))}
            onPaste={(e) => {
              const files = [...e.clipboardData.files];
              if (files.some((f) => f.type.startsWith("image/"))) { e.preventDefault(); addImages(files); return; }
              const pasted = e.clipboardData.getData("text");
              if (URL_RE.test(pasted)) {
                URL_RE.lastIndex = 0;
                e.preventDefault();
                const el = e.currentTarget, at = el.selectionStart, end = el.selectionEnd;
                setDraft(liftLinks({ ...draft, text: draft.text.slice(0, at) + pasted + draft.text.slice(end), saved: null }, true));
              }
              URL_RE.lastIndex = 0;
            }}
          />
          {(draft.links.length > 0 || draft.images.length > 0) && (
            <div className="cw-atts">
              {draft.links.map((u) => (
                <div className="cw-att" key={u}>
                  <span className="ico"><Icon name="source" /></span>
                  <div className="t">{host(u)}</div>
                  <div className="m">{u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)} · read in the background after saving</div>
                  <button className="x" aria-label={`Remove link ${host(u)}`} onClick={() => setDraft({ ...draft, links: draft.links.filter((l) => l !== u), from: null })}><Icon name="close" /></button>
                </div>
              ))}
              {draft.images.map((im, i) => (
                <div className="cw-att" key={im.src}>
                  <img src={im.src} alt="" />
                  <div className="t">{im.file.name || "Pasted image"}</div>
                  <div className="m">Image · {kb(im.file.size)} · made smaller when saved</div>
                  <button className="x" aria-label="Remove image" onClick={() => setDraft({ ...draft, images: draft.images.filter((_, j) => j !== i) })}><Icon name="close" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="cw-will" aria-live="polite">{willSave(draft)}</div>
        {draft.priv && <div className="cw-line">Private: no AI reads this, and nothing about it leaves your Mac.</div>}
        {error && <div className="cw-line cw-err" role="alert">{error}</div>}
        {draft.saved && (
          <div className="cw-saved" role="status">
            ✓ <b>Saved</b> · {draft.saved.what} · <button onClick={() => onOpen(draft.saved!.openId)}>Open it</button>
          </div>
        )}
        <div className="cw-foot">
          <span className="cw-hint">Goes to Unreviewed. The Archivist looks at it in about 2 minutes.</span>
          <button role="switch" aria-checked={draft.priv} className="cw-switch" onClick={() => setDraft({ ...draft, priv: !draft.priv })}>
            <Icon name="lock" /> Private <span className="tr" />
          </button>
          <button className="cw-save" disabled={!can} onClick={save}>Save <kbd>⌘↩</kbd></button>
        </div>
      </div>
    </div>
  );
}
