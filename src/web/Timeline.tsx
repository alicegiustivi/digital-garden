// The Timeline (issue #33): what was captured, written and connected, by day, newest first.
// "Asked" (Inquiries) will join when the Researcher exists.
import { useEffect, useState } from "react";
import { api, type TimelineEvent, type Types } from "./api";
import { Icon, typeVar } from "./ui";

const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dayName = (iso: string) => {
  const d = new Date(iso);
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: days > 300 ? "numeric" : undefined });
};
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const WORD = { captured: "Captured", started: "Started", edited: "Edited", connected: "Connected" } as const;

function Ref({ o, onOpen }: { o: { id: string; type: string; title: string; private: boolean }; onOpen: (id: string) => void }) {
  return (
    <a className="tref" style={typeVar(o.type)} href={`#/o/${o.id}`} onClick={(e) => { e.preventDefault(); onOpen(o.id); }}>
      <Icon name={o.type} /> {o.title}{o.private && <> <Icon name="lock" /></>}
    </a>
  );
}

export function TimelinePage({ onOpen, version }: { types: Types; onOpen: (id: string, ids: string[]) => void; version: number }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => { api.timeline().then((r) => { setEvents(r.events); setNext(r.next); }); }, [version]);
  const loadMore = async () => {
    if (!next) return;
    setMore(true);
    const r = await api.timeline(next);
    setEvents((e) => [...(e ?? []), ...r.events]);
    setNext(r.next);
    setMore(false);
  };
  const days: { key: string; at: string; rows: TimelineEvent[] }[] = [];
  for (const e of events ?? []) {
    const k = dayKey(e.at);
    const d = days.find((x) => x.key === k) ?? (days.push({ key: k, at: e.at, rows: [] }), days[days.length - 1]);
    d.rows.push(e);
  }
  const ids = [...new Set((events ?? []).filter((e) => e.kind !== "connected").map((e) => e.object.id))];
  return (
    <main className="contents wrap timeline">
      <header className="vol"><h2>Timeline</h2></header>
      <p className="quiet small">What was captured, written and connected, day by day. Questions you ask the Researcher will join it when that arrives.</p>
      {events && !events.length && <p className="quiet">Nothing yet. Capture or write something and it will appear here.</p>}
      {days.map((d) => (
        <section key={d.key} className="tday">
          <h3>{dayName(d.at)} <a className="tday-inbox quiet small" href={`#/inbox/${d.key}`} title="What you sent from your phone this day">Daily Inbox →</a></h3>
          <ul>
            {d.rows.map((e, i) => (
              <li key={i}>
                <span className="when">{time(e.at)}</span>
                <span className={`what ${e.kind}`}>{WORD[e.kind === "written" ? (e.detail ?? "started") : e.kind]}</span>
                <span className="subject">
                  <Ref o={e.object} onOpen={(id) => onOpen(id, ids)} />
                  {e.other && <> <span className="quiet">{e.connectionKind}</span> <Ref o={e.other} onOpen={(id) => onOpen(id, [id])} /></>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {next && <p><button className="pill action" disabled={more} onClick={loadMore}>{more ? "Loading…" : "Show earlier days"}</button></p>}
    </main>
  );
}
