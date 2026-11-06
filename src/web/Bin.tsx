import { useEffect, useState } from "react";
import { api, type BinRow, type Types } from "./api";
import { refresh } from "./refresh";
import { Icon, formatDay, typeVar } from "./ui";

/** The Bin: deleted Objects wait here 30 days. Restoring brings back everything, Connections included. */
export function BinPage({ types, onChanged }: { types: Types; onChanged: () => void }) {
  const [rows, setRows] = useState<BinRow[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  const load = () => api.bin().then(setRows);
  useEffect(() => { load(); }, []);
  const run = (p: Promise<unknown>) => p.then(() => { setError(undefined); setConfirming(false); onChanged(); refresh(); return load(); }).catch((e) => setError(e.message));
  const label = (t: string) => types.types.find((x) => x.key === t)?.label ?? t;
  return (
    <main className="contents wrap">
      <header className="vol"><h2>Bin{rows ? <em> {rows.length}</em> : null}</h2></header>
      <p className="quiet small">Deleted Objects wait here for 30 days, hidden from everything else. Restore one and it comes back exactly as it was, with its Connections. After 30 days, or when you empty the Bin, it is gone for good.</p>
      {error && <p className="quiet small" role="alert">{error}</p>}
      {rows && !rows.length && <p className="quiet">The Bin is empty.</p>}
      {rows && rows.length > 0 && (
        <p>
          {!confirming
            ? <button className="pill action" onClick={() => setConfirming(true)}>Empty Bin now…</button>
            : <span className="confirm" role="alertdialog">
                Delete {rows.length} {rows.length === 1 ? "Object" : "Objects"} for good? This can’t be undone.{" "}
                <button className="pill action danger" onClick={() => run(api.emptyBin())}>Empty Bin now</button>{" "}
                <button className="pill toggle" onClick={() => setConfirming(false)}>Keep them</button>
              </span>}
        </p>
      )}
      <ul className="bin-list">
        {rows?.map((r) => (
          <li key={r.id} className="bin-row" style={typeVar(r.type)}>
            <Icon name={r.type} />
            <span className="bin-title">{r.title}</span>
            <span className="quiet small">{label(r.type)} · deleted {formatDay(r.deletedAt)} · {r.daysLeft} {r.daysLeft === 1 ? "day" : "days"} left · {r.connectionCount} {r.connectionCount === 1 ? "Connection" : "Connections"} kept</span>
            <span className="grow" />
            <button className="pill action" onClick={() => run(api.restoreObject(r.id))}>Restore</button>
            <button className="pill toggle" onClick={() => run(api.purge(r.id))} title="Delete this one for good">Delete for good</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
