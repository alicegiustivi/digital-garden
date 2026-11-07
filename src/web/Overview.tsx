// The Overview (issue #34): Concepts as islands sized by what is connected straight to them, a "Not connected yet" shelf,
// and Connect here / Turn into Concept. All of it is local; no AI is involved.
import { useEffect, useState } from "react";
import { api, type Island, type LightUp, type OverviewData, type TagRow, type Types } from "./api";
import { showToast } from "./toast";
import { Icon, tagVar, typeVar } from "./ui";

const FIRST = 24; // how many islands show before "Show the other N"
const size = (n: number) => Math.round(110 + Math.sqrt(n) * 28); // an island's width grows with what is connected, gently

function Mix({ mix, types }: { mix: Island["mix"]; types: Types }) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  if (!total) return <p className="quiet small">Nothing connected yet</p>;
  return (
    <>
      <div className="mixbar" role="img" aria-label={Object.entries(mix).map(([k, n]) => `${n} ${types.types.find((t) => t.key === k)?.plural.toLowerCase()}`).join(", ")}>
        {Object.entries(mix).map(([k, n]) => <span key={k} style={{ ...typeVar(k), flex: n }} />)}
      </div>
      <p className="quiet small">{Object.entries(mix).map(([k, n]) => `${n} ${(n === 1 ? types.types.find((t) => t.key === k)?.label : types.types.find((t) => t.key === k)?.plural)?.toLowerCase()}`).join(" · ")}</p>
    </>
  );
}

function Dots({ weeks }: { weeks: number[] }) {
  return (
    <div className="dots" title="Connected Objects made or changed in each of the last 8 weeks, this week last" aria-label={`Activity in the last 8 weeks: ${weeks.join(", ")}`}>
      {weeks.map((n, i) => <i key={i} className={n ? "on" : ""} style={{ ["--a" as string]: Math.min(n, 3) }} />)}
    </div>
  );
}

export function OverviewPage({ types, version, onOpen, go, onChanged }: { types: Types; version: number; onOpen: (id: string, ids: string[]) => void; go: (h: string) => void; onChanged: () => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [light, setLight] = useState<LightUp | null>(null);
  const [all, setAll] = useState(false);
  const load = () => api.overview().then(setData);
  useEffect(() => { load(); }, [version]);
  useEffect(() => {
    setLight(null);
    if (picked) api.lightUp(picked).then(setLight).catch(() => setPicked(null));
  }, [picked, version]);
  if (!data) return <main className="contents wrap"><p className="quiet">Opening…</p></main>;

  const pickedObj = data.shelf.find((s) => s.id === picked);
  const lit = new Map(light?.islands.map((i) => [i.id, i]));
  const connectHere = async (island: Island) => {
    if (!picked) return;
    try {
      const c = await api.connect(picked, island.id);
      const title = pickedObj?.title ?? "That Object";
      setPicked(null);
      onChanged();
      showToast(`Connected “${title}” to ${island.title}.`, async () => { await api.disconnect(c.id); onChanged(); });
    } catch (e) { showToast((e as Error).message); }
  };
  const turn = async (t: TagRow) => {
    const r = await api.turnIntoConcept(t.id, true);
    onChanged();
    showToast(`Made the Concept “${r.concept.title}” and connected ${r.connected} ${r.connected === 1 ? "Object" : "Objects"}; #${t.name} is removed.`, async () => { await api.undoConcept(r); onChanged(); });
  };

  const shown = all ? data.islands : data.islands.slice(0, FIRST);
  return (
    <main className="contents wrap">
      <header className="vol"><h2>Overview{data.islands.length ? <em> {data.islands.length} {data.islands.length === 1 ? "Concept" : "Concepts"}</em> : null}</h2></header>

      {!data.islands.length && (
        <>
          <p className="quiet">You have no Concepts yet. A Concept is an area you decide to explore once enough has gathered. {data.dashed.length ? "These are your biggest Tags; turn one into a Concept to start an island." : "Tag a few Objects, and the biggest Tags will show here as dashed islands."}</p>
          <div className="islands">
            {data.dashed.map((t) => {
              const on = !!light?.tags.includes(t.name);
              return (
                <article key={t.id} className={`island dashed ${picked ? (on ? "lit" : "dim") : ""}`} style={{ ["--d" as string]: `${size(t.count)}px`, ...tagVar(t.color) }}>
                  <div className="blob" aria-hidden="true">{t.count}</div>
                  <h4>#{t.name}</h4>
                  <p className="quiet small">{t.count} tagged · not a Concept yet</p>
                  <p className="tag-actions">
                    <button className="pill action" onClick={() => turn(t)}>Turn into Concept</button>{" "}
                    <a className="pill toggle" href={`#/tags/${encodeURIComponent(t.name)}`}>See them</a>
                  </p>
                </article>
              );
            })}
          </div>
        </>
      )}

      <div className="islands">
        {shown.map((i) => {
          const l = lit.get(i.id);
          const cls = picked ? (l ? "lit" : "dim") : "";
          return (
            <article key={i.id} className={`island ${cls}`} style={{ ["--d" as string]: `${size(i.size)}px`, ...typeVar("concept") }} tabIndex={0} role="button" onClick={() => onOpen(i.id, data.islands.map((x) => x.id))} onKeyDown={(e) => e.key === "Enter" && onOpen(i.id, data.islands.map((x) => x.id))}>
              <div className="blob" aria-hidden="true">{i.size}</div>
              <h4><Icon name="concept" /> {i.title}{i.private && <> <Icon name="lock" /></>}</h4>
              <Mix mix={i.mix} types={types} />
              <Dots weeks={i.weeks} />
              {i.recent.length > 0 && <ul>{i.recent.map((r) => <li key={r.id} style={typeVar(r.type)}><Icon name={r.type} /> {r.title}</li>)}</ul>}
              {l && (
                <div onClick={(e) => e.stopPropagation()}>
                  {l.connected ? <span className="quiet small">Already connected</span> : <button className="pill action connect-here" onClick={() => connectHere(i)}>Connect here</button>}
                  {l.shared.length > 0 && <p className="quiet small">shares {l.shared.map((t) => `#${t}`).join(" ")}</p>}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {data.islands.length > FIRST && (
        <p><button className="pill toggle" onClick={() => setAll(!all)}>{all ? `Show only the biggest ${FIRST}` : `Show the other ${data.islands.length - FIRST}`}</button></p>
      )}

      <section className="ugroup">
        <div className="ugroup-h"><h3>Not connected yet <span className="quiet">{data.shelfTotal}</span></h3></div>
        {!data.shelf.length && <p className="quiet">Everything is connected to a Concept.</p>}
        {data.shelf.length > 0 && <p className="quiet small">Not connected straight to any Concept. Pick one to light up the islands that share its Tags.</p>}
        <div className="shelf">
          {data.shelf.map((s) => (
            <button key={s.id} className={`shelf-item ${s.id === picked ? "on" : ""}`} style={typeVar(s.type)} aria-pressed={s.id === picked} onClick={() => setPicked(s.id === picked ? null : s.id)}>
              <Icon name={s.type} /> {s.title}{s.private && <> <Icon name="lock" /></>}
            </button>
          ))}
        </div>
        {data.shelfTotal > data.shelf.length && <p className="quiet small">Showing the newest {data.shelf.length}.</p>}
        {picked && pickedObj && (
          <p className="confirm">
            <span><strong>{pickedObj.title}</strong>{pickedObj.tags.length ? <> carries {pickedObj.tags.map((t) => `#${t}`).join(" ")}.</> : " has no Tags."}</span>{" "}
            {light && !light.islands.length && <span className="quiet small">No island shares its Tags.</span>}
            <button className="pill action" onClick={() => onOpen(pickedObj.id, data.shelf.map((x) => x.id))}>Open</button>
          </p>
        )}
      </section>

      {data.several.length > 0 && (
        <section className="ugroup several">
          <div className="ugroup-h"><h3>In several Concepts <span className="quiet">{data.several.length}</span></h3></div>
          <ul className="quiet-list">
            {data.several.map((s) => (
              <li key={s.id} style={typeVar(s.type)}>
                <a href={`#/o/${s.id}`}><Icon name={s.type} /> {s.title}</a>
                <span className="quiet small">in {s.concepts.map((c) => c.title).join(", ")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
