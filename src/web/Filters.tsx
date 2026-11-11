// The filters and sort order every list and the Search page share (issue #33): type, Tag, date, Unreviewed, No Connections yet.
import { useEffect, useMemo, useState } from "react";
import { STAGES } from "../shared/palette";
import { api, type Filters, type TagRow, type Types } from "./api";

export type FilterState = { type: string; tag: string; date: string; unreviewed: boolean; noConnections: boolean; stage: string };
export const noFilters: FilterState = { type: "", tag: "", date: "", unreviewed: false, noConnections: false, stage: "" };

const DATES: [string, string][] = [["", "Any time"], ["today", "Today"], ["7", "Past 7 days"], ["30", "Past 30 days"], ["365", "Past year"]];
const SORTS: [string, string][] = [["relevance", "Best match"], ["changed", "Recently changed"], ["created", "Newest captured"], ["title", "A to Z"]];

const sinceOf = (date: string) => (date === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).toISOString() : date ? new Date(Date.now() - Number(date) * 864e5).toISOString() : undefined);

/** The filter state as the query the server takes. The date is worked out once per choice, so the list does not reload by itself. */
export function useFilterQuery(f: FilterState, sort: string): Filters {
  const since = useMemo(() => sinceOf(f.date), [f.date]);
  return useMemo(
    () => ({ type: f.type || undefined, tag: f.tag || undefined, since, unreviewed: f.unreviewed ? "1" : undefined, noConnections: f.noConnections ? "1" : undefined, stage: STAGES[f.type] ? f.stage || undefined : undefined, sort: sort || undefined }),
    [f.type, f.tag, f.stage, since, f.unreviewed, f.noConnections, sort],
  );
}

const KEY = (scope: string) => `garden.sort.${scope}`;
/** The sort order, remembered for each kind of list on this Mac. */
export function useSort(scope: string, fallback: string, allowRelevance: boolean): [string, (s: string) => void] {
  const read = () => {
    let v: string | null = null;
    try { v = localStorage.getItem(KEY(scope)); } catch { /* private window: no memory */ }
    return v && SORTS.some(([k]) => k === v) && (allowRelevance || v !== "relevance") ? v : fallback;
  };
  const [sort, setSort] = useState(read);
  useEffect(() => setSort(read()), [scope]);
  const choose = (s: string) => { setSort(s); try { localStorage.setItem(KEY(scope), s); } catch { /* fine */ } };
  return [sort, choose];
}

export function FilterBar({ value, onChange, types, sort, onSort, relevance = false, lock = [] }: {
  value: FilterState; onChange: (f: FilterState) => void; types: Types; sort: string; onSort: (s: string) => void; relevance?: boolean; lock?: ("type" | "tag" | "stage")[];
}) {
  const [tags, setTags] = useState<TagRow[]>([]);
  useEffect(() => { api.tags().then(setTags); }, []);
  const set = (p: Partial<FilterState>) => onChange({ ...value, ...p });
  return (
    <div className="filters" role="group" aria-label="Filters">
      {!lock.includes("type") && (
        <label>Type
          <select value={value.type} onChange={(e) => set({ type: e.target.value, stage: "" })}>
            <option value="">All</option>
            {types.types.map((t) => <option key={t.key} value={t.key}>{t.plural}</option>)}
          </select>
        </label>
      )}
      {STAGES[value.type] && !lock.includes("stage") && (
        <label>Stage
          <select value={value.stage} onChange={(e) => set({ stage: e.target.value })}>
            <option value="">Any</option>
            {STAGES[value.type].listOrder.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      )}
      {!lock.includes("tag") && (
        <label>Tag
          <select value={value.tag} onChange={(e) => set({ tag: e.target.value })}>
            <option value="">Any</option>
            {tags.map((t) => <option key={t.id} value={t.name}>#{t.name} ({t.count})</option>)}
          </select>
        </label>
      )}
      <label>Date
        <select value={value.date} onChange={(e) => set({ date: e.target.value })}>
          {DATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      <button className={`pill toggle ${value.unreviewed ? "on" : ""}`} aria-pressed={value.unreviewed} onClick={() => set({ unreviewed: !value.unreviewed })}>Unreviewed</button>
      <button className={`pill toggle ${value.noConnections ? "on" : ""}`} aria-pressed={value.noConnections} onClick={() => set({ noConnections: !value.noConnections })}>No Connections yet</button>
      <span className="grow" />
      <label>Sort
        <select value={sort} onChange={(e) => onSort(e.target.value)}>
          {SORTS.filter(([k]) => relevance || k !== "relevance").map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
    </div>
  );
}
