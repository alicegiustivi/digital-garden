// The two newer kinds of property on a type the owner made (ADR 0010): a rating in stars, and a picture (a book cover).
// Both are the owner's own: the Archivist never sets a rating or a picture, and no picture is ever sent to an AI.
import { useRef, useState } from "react";
import { api, type Obj } from "./api";
import { refresh } from "./refresh";
import { showToast } from "./toast";
import { Icon } from "./ui";

/** 1 to 5 stars. Click a star to set it, click the same star again to clear. Arrow keys move it. */
export function Stars({ value, label, onSave }: { value: number; label: string; onSave: (v: string) => void }) {
  return (
    <span className="stars" role="radiogroup" aria-label={`${label}, ${value ? `${value} of 5 stars` : "not rated"}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ${n === 1 ? "star" : "stars"}`} className={n <= value ? "on" : ""}
          onClick={() => onSave(value === n ? "" : String(n))}
          onKeyDown={(e) => { if (e.key === "ArrowRight" && value < 5) { e.preventDefault(); onSave(String(value + 1)); } if (e.key === "ArrowLeft" && value > 1) { e.preventDefault(); onSave(String(value - 1)); } }}>
          <Icon name="star" />
        </button>
      ))}
    </span>
  );
}

/** Read-only stars (cards and lists). */
export const StarsView = ({ value }: { value: number }) => (
  <span className="stars view" role="img" aria-label={`${value} of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= value ? "on" : ""}><Icon name="star" /></span>)}</span>
);

type Back = { stem: string; width: number | null; height: number | null } | null;
type Answer = Obj & { previous: Back };

/** A picture on a property: click to choose, drop one on it, or click it and paste. Replace or remove, with Undo (the same way as a Person's Portrait). */
export function PictureProp({ obj, field, label, onChanged }: { obj: Obj; field: string; label: string; onChanged: (o: Obj) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const stem = obj.images?.[field];
  const apply = (o: Answer) => { const { previous: _p, ...rest } = o as any; onChanged(rest as Obj); refresh(); };
  const undoTo = (back: Back) => async () => apply(await api.restorePropImage(obj.id, field, back));
  const choose = async (files: File[]) => {
    const pic = files.find((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!pic) { showToast("That isn't a picture. Choose an image file (HEIC works too)."); return; }
    setBusy(true);
    try {
      const r = await api.setPropImage(obj.id, field, pic);
      apply(r);
      showToast(stem ? `${label} replaced.` : `${label} added.`, undoTo(r.previous));
    } catch (e) { showToast((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => { const r = await api.removePropImage(obj.id, field); apply(r); showToast(`${label} removed.`, undoTo(r.previous)); };
  return (
    <div className={`pic-prop${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void choose([...e.dataTransfer.files]); }}>
      <button type="button" className="pic-pick" disabled={busy} aria-label={stem ? `Replace ${label}` : `Add ${label}`}
        title="Click to choose a picture. You can also drop one here, or click and then paste (⌘V)."
        onClick={() => input.current?.click()}
        onPaste={(e) => { const f = [...e.clipboardData.files]; if (f.length) { e.preventDefault(); void choose(f); } }}>
        {stem ? <img src={`/api/prop-images/${stem}/full`} alt={label} /> : <span className="pic-empty"><Icon name="camera" /></span>}
        {busy && <span className="portrait-busy">Shrinking…</span>}
      </button>
      <input ref={input} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void choose(f); }} />
      <span className="portrait-actions">
        {stem ? (<><button type="button" className="linkish" onClick={() => input.current?.click()}>Replace</button><button type="button" className="linkish" onClick={remove}>Remove</button></>)
          : <button type="button" className="linkish" onClick={() => input.current?.click()}>Add {label.toLowerCase()}</button>}
        {!stem && <span className="quiet small">or drop a picture here</span>}
      </span>
    </div>
  );
}
