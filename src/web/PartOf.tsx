// "Part of" (issue #140): a Project lists its Pieces by Stage in an order the owner drags (its outline), and a Piece shows its Project.
// Only the owner makes these links; nothing here changes a Stage.
import { useEffect, useState } from "react";
import { STAGES } from "../shared/palette";
import { api, type AlreadyPartOf, type PartBrief, type ProjectPieces, type Types } from "./api";
import { FindObject } from "./Connections";
import { refresh, useRefresh } from "./refresh";
import { showToast } from "./toast";
import { Icon, typeVar } from "./ui";

const asksToMove = (e: unknown) => (e as { data?: Partial<AlreadyPartOf> }).data?.partOf;

/** Connect a Piece to a Project as "part of"; if it already has one, say so and offer to move it. */
function usePartOf(onDone?: () => void) {
  const [error, setError] = useState<string>();
  const [movable, setMovable] = useState<{ piece: string; project: string; from: string } | null>(null);
  const put = async (piece: string, project: string, move = false) => {
    try {
      await api.connect(piece, project, "part of", move);
      setError(undefined); setMovable(null); refresh(); onDone?.();
    } catch (e) {
      setError((e as Error).message);
      const was = asksToMove(e);
      setMovable(was ? { piece, project, from: was.title } : null);
    }
  };
  const notice = error && (
    <p className="quiet small part-notice" role="alert">
      {error}{" "}
      {movable && <button className="pill action" onClick={() => put(movable.piece, movable.project, true)}>Move it here</button>}
    </p>
  );
  return { put, notice };
}

/** On a Project's page: its Pieces by Stage, in the order the owner drags them into. */
export function ProjectPieces({ id, types, beside }: { id: string; types: Types; beside: (id: string) => void }) {
  const tick = useRefresh();
  const [data, setData] = useState<ProjectPieces | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { put, notice } = usePartOf(() => setAdding(false));
  useEffect(() => { api.pieces(id).then(setData).catch(() => setData(null)); }, [id, tick]);
  if (!data) return null;
  const st = STAGES.piece;
  const stageOf = (p: PartBrief) => (st.stages.includes(p.stage) ? p.stage : st.first);
  const all = data.pieces;

  // The order is one list for the whole Project; a Stage only decides which group a Piece shows in. Moving inside a group moves it inside that list.
  const save = (next: typeof all) => { setData({ ...data, pieces: next }); api.orderPieces(id, next.map((p) => p.id)).then(setData).catch((e) => { showToast(e.message); refresh(); }); };
  const place = (moving: string, target: string, after: boolean) => {
    if (moving === target) return;
    const m = all.find((p) => p.id === moving), t = all.find((p) => p.id === target);
    if (!m || !t || stageOf(m) !== stageOf(t)) return; // a Piece moves among the others of its own Stage
    const rest = all.filter((p) => p.id !== moving);
    const at = rest.findIndex((p) => p.id === target) + (after ? 1 : 0);
    save([...rest.slice(0, at), m, ...rest.slice(at)]);
  };
  const nudge = (p: PartBrief, dir: -1 | 1) => {
    const group = all.filter((x) => stageOf(x) === stageOf(p));
    const other = group[group.findIndex((x) => x.id === p.id) + dir];
    if (other) place(p.id, other.id, dir === 1);
  };

  return (
    <section className="project-pieces" aria-label="Pieces" style={typeVar("piece")}>
      <header>
        <h3>Pieces{all.length ? <em> {all.length}</em> : null}</h3>
        <button className="pill action" onClick={() => setAdding(!adding)} aria-expanded={adding}><Icon name="plus" /> Add a Piece</button>
      </header>
      {adding && (
        <FindObject types={types} exclude={id} onlyType="piece" action="Add" beside={beside} onClose={() => setAdding(false)} onPick={(f) => put(f.id, id)} />
      )}
      {notice}
      {!all.length && !adding && <p className="quiet small">No Pieces yet. A Project with no Pieces, like a trip, is just this page. To make one a Piece of this Project, press Add a Piece.</p>}
      <div className="stage-groups">
        {st.listOrder.map((s) => {
          const list = all.filter((p) => stageOf(p) === s);
          if (!list.length) return null;
          const rows = (
            <ul className="stage-rows outline">
              {list.map((p, i) => (
                <li
                  key={p.id}
                  className={`outline-row${dragging === p.id ? " dragging" : ""}${over === p.id ? " over" : ""}`}
                  draggable
                  onDragStart={(e) => { setDragging(p.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }}
                  onDragEnd={() => { setDragging(null); setOver(null); }}
                  onDragOver={(e) => { if (dragging && dragging !== p.id) { const d = all.find((x) => x.id === dragging); if (d && stageOf(d) === s) { e.preventDefault(); setOver(p.id); } } }}
                  onDragLeave={() => setOver((o) => (o === p.id ? null : o))}
                  onDrop={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    if (dragging) place(dragging, p.id, e.clientY > r.top + r.height / 2);
                    setDragging(null); setOver(null);
                  }}
                >
                  <span className="grip" aria-hidden="true" title="Drag to change the order">⋮⋮</span>
                  <a className="outline-title" href={`#/o/${p.id}`} onClick={(e) => { if (e.altKey) { e.preventDefault(); beside(p.id); } }}>
                    {p.title}{p.private && <span title="Private: no AI reads this"> <Icon name="lock" /></span>}
                  </a>
                  <span className="outline-move">
                    <button className="x" disabled={i === 0} onClick={() => nudge(p, -1)} aria-label={`Move ${p.title} up`} title="Move up">↑</button>
                    <button className="x" disabled={i === list.length - 1} onClick={() => nudge(p, 1)} aria-label={`Move ${p.title} down`} title="Move down">↓</button>
                  </span>
                </li>
              ))}
            </ul>
          );
          return s === "Finished"
            ? <details key={s} className="stage-group"><summary><h3>{s} <span className="quiet">{list.length}</span></h3></summary>{rows}</details>
            : <section key={s} className="stage-group"><h3>{s} <span className="quiet">{list.length}</span></h3>{rows}</section>;
        })}
      </div>
      {all.length > 1 && <p className="quiet small">Drag a Piece to change the order. It is kept for this Project only; a Piece’s Stage and the Project’s Stage are separate.</p>}
    </section>
  );
}

/** On a Piece's page: the Project it belongs to (name, Stage), or that it stands alone. */
export function PieceProject({ id, types, beside }: { id: string; types: Types; beside: (id: string) => void }) {
  const tick = useRefresh();
  const [project, setProject] = useState<undefined | null | (PartBrief & { connectionId: number })>(undefined);
  const [finding, setFinding] = useState(false);
  const { put, notice } = usePartOf(() => setFinding(false));
  useEffect(() => { api.projectOf(id).then((r) => setProject(r.project)).catch(() => setProject(undefined)); }, [id, tick]);
  if (project === undefined) return null;
  const takeOut = () =>
    api.disconnect(project!.connectionId).then((r) => { refresh(); showToast(`Taken out of “${project!.title}”. It stands alone now.`, () => api.restoreConnection(r.was).then(refresh)); }).catch((e) => showToast(e.message));
  return (
    <div className="piece-project" aria-label="Project">
      {project ? (
        <p>
          <span className="quiet">Part of</span>{" "}
          <a className="piece-project-link" style={typeVar("project")} href={`#/o/${project.id}`} onClick={(e) => { if (e.altKey) { e.preventDefault(); beside(project.id); } }}>
            <Icon name="project" /> {project.title}{project.private && <> <Icon name="lock" /></>}
          </a>
          <span className="quiet"> · {project.stage}</span>{" "}
          <button className="linkish" onClick={takeOut}>Take out</button>
        </p>
      ) : (
        <p>
          <span className="quiet">Stands alone.</span>{" "}
          <button className="linkish" onClick={() => setFinding(!finding)} aria-expanded={finding}>Put in a Project</button>
        </p>
      )}
      {finding && <FindObject types={types} exclude={id} onlyType="project" action="Put here" beside={beside} onClose={() => setFinding(false)} onPick={(f) => put(id, f.id)} />}
      {notice}
    </div>
  );
}
