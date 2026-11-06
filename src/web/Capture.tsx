// The Capture window (issues #21, #23): one box, a "Will save as…" line, Private beside Save ⌘↩.
// This build handles typed words, which become a Thought. Links and images come in later builds.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Icon, TypeChip } from "./ui";

export type CaptureDraft = { text: string; priv: boolean; saved: { id: string; what: string } | null };
export const emptyDraft: CaptureDraft = { text: "", priv: false, saved: null };

/** ⌘N is kept by the browser for "new window" in an ordinary tab; an installed web-app window may let it through. */
export const standalone = () => window.matchMedia("(display-mode: standalone)").matches;
export const captureKey = () => (standalone() ? "⌘N" : "⌥⌘N");

/** True for the keys that open Capture: ⌘N, the fallback ⌥⌘N, and plain N when not typing. */
export function isCaptureKey(e: KeyboardEvent): boolean {
  const typing = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true]");
  if (e.code === "KeyN" && e.metaKey && !e.ctrlKey && !e.shiftKey) return true; // ⌘N and ⌥⌘N
  return e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
}

export function Capture({ draft, setDraft, onClose, onSaved, onOpen }: {
  draft: CaptureDraft; setDraft: (d: CaptureDraft) => void; onClose: () => void; onSaved: () => void; onOpen: (id: string) => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const can = draft.text.trim().length > 0 && !busy;

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = "auto";
    ta.current.style.height = Math.min(ta.current.scrollHeight, window.innerHeight * 0.4) + "px";
  }, [draft.text]);

  const save = async () => {
    if (!can) return;
    setBusy(true); setError(null);
    try {
      const o = await api.capture(draft.text, draft.priv);
      // The box clears and Private switches itself off after every save.
      setDraft({ text: "", priv: false, saved: { id: o.id, what: "a Thought" + (o.private ? " · Private" : "") } });
      onSaved();
      ta.current?.focus();
    } catch (e) {
      setError((e as Error).message || "Couldn't save. Your words are still here.");
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
        <div className="cw-box">
          <textarea
            ref={ta}
            aria-label="Capture"
            placeholder="Type a thought, paste a link, or drop an image…"
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value, saved: null })}
          />
        </div>
        <div className="cw-will" aria-live="polite">
          {draft.text.trim() && (<>Will save as <TypeChip type="thought" label="Thought" />{draft.priv && <span className="cw-priv"><Icon name="lock" /> Private</span>}</>)}
        </div>
        {draft.priv && <div className="cw-line">Private: no AI reads this, and nothing about it leaves your Mac.</div>}
        {error && <div className="cw-line cw-err" role="alert">{error}</div>}
        {draft.saved && (
          <div className="cw-saved" role="status">
            ✓ <b>Saved</b> · {draft.saved.what} · <button onClick={() => onOpen(draft.saved!.id)}>Open it</button>
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
