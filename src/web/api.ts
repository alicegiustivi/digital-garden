export type Origin = "source" | "ai" | "owner";
export type OriginInfo = { origin: Origin; aiRole: string | null; aiModel: string | null; aiDate: string | null; /** An AI Suggestion the owner approved: still AI Origin, marked ✧. */ approved?: boolean };
export type Field = { key: string; value: string } & OriginInfo;
export type Tag = { id: number; name: string; color: string } & OriginInfo;
export type Block = { id: number; text: string } & OriginInfo;
export type Summary = {
  id: string; type: string; private: boolean; unreviewed: boolean; hasImage: boolean; createdAt: string; updatedAt: string;
  fields: Field[]; firstLine: string; tags: Tag[]; connectionCount: number;
};
export type MentionInfo = { id: string; missing: boolean; type?: string; title?: string; private?: boolean; tags?: Tag[]; connectionCount?: number; inBin?: boolean; kind?: string | null; label?: string | null };
export type Obj = Summary & {
  blocks: Block[]; mentions?: Record<string, MentionInfo>;
  typeAi?: { aiRole: string; aiModel: string; aiDate: string } | null; aiReadBeforePrivate?: string | null;
};
type SuggestionBase = { id: number; origin: "ai"; aiRole: string; aiModel: string; aiDate: string; approved: false };
export type Suggestion = SuggestionBase & (
  | { kind: "connection"; other: { id: string; type: string; title: string }; connectionKind: string }
  | { kind: "type"; type: string; typeLabel: string }
  | { kind: "object"; type: string; typeLabel: string; name: string }
  | { kind: "title"; title: string }
);
export type Suggestions = { pending: Suggestion[]; rejected: number };
export type AiNote = { id: number; kind: "summary" | "prompt"; text: string } & OriginInfo;
export type RemovedNote = { objectId: string; kind: string; text: string; aiRole: string; aiModel: string; aiDate: string };
export type Found = Summary & { title: string; connected: boolean };
export type Brief = { id: string; type: string; title: string; private: boolean; tags: Tag[]; connectionCount: number };
export type Connection = {
  id: number; other: Brief; kind: string; label: string; subject: boolean; note: string; sentence: string | null; sentenceBy: "other" | "me" | null; fromText: boolean;
} & OriginInfo;
export type KindChoice = { kind: string; subject: boolean; label: string };
export type Shares = Brief & { shared: string[]; sharedTags: string[] };
export type MergeAsk = { otherId: string; other: Brief; keep: { kind: string; label: string; note: string }; drop: { kind: string; label: string; note: string } };
export type FieldDef = { key: string; label: string; input: "text" | "longtext" | "select"; options: string[] | null; lead?: boolean };
export type TypeDef = { key: string; label: string; plural: string; fields: FieldDef[] };
export type Types = { types: TypeDef[]; fieldLabels: Record<string, FieldDef> };
export type CaptureResult = { created: Obj[]; existing: Obj[]; thoughtId: string | null; openId: string };
export type BinRow = Summary & { title: string; deletedAt: string; daysLeft: number };
export type RemovedConnection = { fromId: string; toId: string; kind: string; note: string | null } & OriginInfo;
export type RemovedTag = { tag: TagRow; objects: number; on: ({ objectId: string } & OriginInfo)[] };
export type AiSummary = {
  keySet: boolean; keyProblem: boolean; left: number; waiting: number;
  budgets: { archivist: { used: number; limit: number }; researcher: { used: number; limit: number } };
  reset: { at: string; source: string }; models: string[];
};
export type AiRun = { id: number; model: string; at: string; facts: string[]; tags: string[] };
export type AiStatus = { pending?: number; state: "none" | "private" | "waiting" | "working" | "busy" | "tomorrow" | "failed" | "done"; run: AiRun | null; canRun: boolean; nextTryAt?: string; needsKey?: boolean };
export type Filters = { type?: string; tag?: string; since?: string; until?: string; unreviewed?: string; noConnections?: string; sort?: string };
export type Hit = Summary & { title: string; match: { where: "title" | "tag" | "body" | "field" | "note"; label: string; text: string; origin: OriginInfo } | null };
export type FindResult = { hits: Hit[]; total: number; terms: string[]; corrected: { from: string; to: string[] }[]; sort: string };
export type Brief2 = { id: string; type: string; title: string; private: boolean };
export type TimelineEvent = { kind: "captured" | "written" | "connected"; detail: "started" | "edited" | null; at: string; object: Brief2; other: Brief2 | null; connectionKind: string | null };
export type RenamedTag = { tags: TagRow[]; was: { name: string; on: unknown[] } };
export type MergedTag = { tags: TagRow[]; merged: { from: TagRow; into: TagRow; on: unknown[]; added: string[] } };
export type IslandBrief = { id: string; type: string; title: string; private: boolean };
export type Island = { id: string; title: string; private: boolean; size: number; mix: Record<string, number>; weeks: number[]; recent: IslandBrief[] };
export type OverviewData = {
  islands: Island[]; several: (IslandBrief & { concepts: { id: string; title: string }[] })[];
  shelf: (IslandBrief & { tags: string[] })[]; shelfTotal: number; dashed: TagRow[];
};
export type LightUp = { tags: string[]; islands: { id: string; shared: string[]; connected: boolean }[] };
export type TurnedIntoConcept = { concept: { id: string; title: string }; connected: number; removed: RemovedTag | null };
export type Brief3 = { id: string; type: string; title: string; private: boolean };
export type Question = { id: string; title: string; private: boolean; state: "open" | "settled"; openedAt: string; settledAt: string | null; settledBy: { id: string; title: string } | null; touchedAt: string };
export type DeskRow = Brief3 & { connectionId: number; kind: string; label: string; approved: boolean; changedAt: string };
export type Desk = {
  id: string; createdAt: string; total: number; mix: Record<string, number>;
  groups: { key: string; label: string; items: DeskRow[] }[];
  tensions: { a: Brief3; b: Brief3; connectionId: number }[];
  questions: Question[]; suggested: number; privateCount: number;
  versions: { day: string; paragraphs: string[] }[];
};
export type QuestionsPage = { open: (Question & { concepts: { id: string; title: string }[] })[]; settled: (Question & { concepts: { id: string; title: string }[] })[] };
export type GardenItem = Brief3 & { reason: string };
export type TagRow = { id: number; name: string; color: string; count: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

const params = (q: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "" && v !== null).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  ai: () => call<AiSummary>("GET", "/api/ai"),
  saveAiKey: (key: string) => call<AiSummary>("PUT", "/api/ai/key", { key }),
  forgetAiKey: () => call<AiSummary>("DELETE", "/api/ai/key"),
  aiFlush: () => call<unknown>("POST", "/api/ai/flush"),
  aiStatus: (id: string) => call<AiStatus>("GET", `/api/objects/${id}/ai`),
  aiRun: (id: string) => call<AiStatus>("POST", `/api/objects/${id}/ai/run`),
  aiUndo: (id: string) => call<Obj>("POST", `/api/objects/${id}/ai/undo`),
  suggestions: (id: string) => call<Suggestions>("GET", `/api/objects/${id}/suggestions`),
  approve: (sid: number) => call<Obj>("POST", `/api/suggestions/${sid}/approve`),
  reject: (sid: number) => call<unknown>("POST", `/api/suggestions/${sid}/reject`),
  forgetRejected: (id: string) => call<unknown>("POST", `/api/objects/${id}/ai/forget-rejected`),
  aiNotes: (id: string) => call<AiNote[]>("GET", `/api/objects/${id}/ai-notes`),
  deleteAiNote: (nid: number) => call<{ was: RemovedNote }>("DELETE", `/api/ai-notes/${nid}`),
  restoreAiNote: (n: RemovedNote) => call<unknown>("POST", "/api/ai-notes/restore", n),
  thoughtFromNote: (nid: number) => call<Obj>("POST", `/api/ai-notes/${nid}/thought`),
  types: () => call<Types>("GET", "/api/types"),
  list: (q: Filters = {}) => call<Summary[]>("GET", "/api/objects?" + params(q)),
  find: (q: Filters & { q?: string; limit?: number }) => call<FindResult>("GET", "/api/find?" + params(q)),
  recent: (ids: string[]) => call<Hit[]>("GET", "/api/recent?ids=" + ids.join(",")),
  timeline: (before?: string) => call<{ events: TimelineEvent[]; next: string | null }>("GET", "/api/timeline?" + params({ before, limit: 120 })),
  renameTag: (id: number, name: string) => call<RenamedTag>("POST", `/api/tags/${id}/rename`, { name }),
  undoRename: (id: number, was: RenamedTag["was"]) => call<TagRow[]>("POST", `/api/tags/${id}/rename/undo`, was),
  mergeTag: (id: number, into: number) => call<MergedTag>("POST", `/api/tags/${id}/merge`, { into }),
  undoMerge: (m: MergedTag["merged"]) => call<TagRow[]>("POST", "/api/tags/unmerge", m),
  capture: async (c: { text: string; links: string[]; images: File[]; private: boolean }): Promise<CaptureResult> => {
    const payload = JSON.stringify({ text: c.text, links: c.links, private: c.private });
    if (!c.images.length) return call("POST", "/api/capture", JSON.parse(payload));
    const form = new FormData();
    form.set("payload", payload);
    c.images.forEach((f) => form.append("images", f, f.name));
    const res = await fetch("/api/capture", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
  reviewed: (ids: string[]) => call<{ reviewed: number }>("POST", "/api/reviewed", { ids }),
  get: (id: string) => call<Obj>("GET", `/api/objects/${id}`),
  create: (type: string) => call<Obj>("POST", "/api/objects", { type }),
  patch: (id: string, patch: { type?: string; private?: boolean; fields?: Record<string, string | null> }) =>
    call<Obj>("PATCH", `/api/objects/${id}`, patch),
  setBody: (id: string, paragraphs: string[]) => call<Obj>("PUT", `/api/objects/${id}/body`, { paragraphs }),
  addTag: (id: string, name: string) => call<Obj>("POST", `/api/objects/${id}/tags`, { name }),
  removeTag: (id: string, tagId: number) => call<Obj>("DELETE", `/api/objects/${id}/tags/${tagId}`),
  search: (q: { q?: string; type?: string; exclude?: string; limit?: number }) =>
    call<Found[]>("GET", "/api/search?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))),
  connections: (id: string) => call<Connection[]>("GET", `/api/objects/${id}/connections`),
  kinds: () => call<KindChoice[]>("GET", "/api/connection-kinds"),
  sharesWords: (id: string) => call<Shares[]>("GET", `/api/objects/${id}/shares-words`),
  connect: (a: string, b: string) => call<Connection>("POST", "/api/connections", { a, b }),
  setConnection: (id: number, patch: { kind?: string; subject?: string; note?: string }) => call<unknown>("PATCH", `/api/connections/${id}`, patch),
  disconnect: (id: number) => call<{ was: RemovedConnection }>("DELETE", `/api/connections/${id}`),
  restoreConnection: (was: RemovedConnection) => call<unknown>("POST", "/api/connections/restore", was),
  deleteObject: (id: string) => call<unknown>("DELETE", `/api/objects/${id}`),
  restoreObject: (id: string) => call<unknown>("POST", `/api/objects/${id}/restore`),
  bin: () => call<BinRow[]>("GET", "/api/bin"),
  emptyBin: () => call<{ purged: number }>("POST", "/api/bin/empty"),
  purge: (id: string) => call<unknown>("DELETE", `/api/bin/${id}`),
  restoreTagOn: (id: string, tagId: number, o: OriginInfo) => call<Obj>("POST", `/api/objects/${id}/tags/${tagId}/restore`, o),
  deleteTag: (id: number) => call<RemovedTag>("DELETE", `/api/tags/${id}`),
  restoreTag: (r: RemovedTag) => call<unknown>("POST", "/api/tags/restore", r),
  merge: async (keepId: string, fromId: string, picks: Record<string, string> = {}): Promise<{ done: true } | { ask: MergeAsk[] }> => {
    const res = await fetch(`/api/objects/${keepId}/merge`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: fromId, picks }) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 409) return { ask: j.needsChoice };
    if (!res.ok) throw new Error(j.error ?? res.statusText);
    return { done: true };
  },
  overview: () => call<OverviewData>("GET", "/api/overview"),
  lightUp: (id: string) => call<LightUp>("GET", `/api/objects/${id}/light-up`),
  turnIntoConcept: (tagId: number, removeTag: boolean) => call<TurnedIntoConcept>("POST", `/api/tags/${tagId}/concept`, { removeTag }),
  undoConcept: (r: TurnedIntoConcept) => call<unknown>("POST", "/api/concepts/undo", { conceptId: r.concept.id, removed: r.removed }),
  desk: (id: string) => call<Desk>("GET", `/api/concepts/${id}/desk`),
  question: (id: string) => call<Question | null>("GET", `/api/objects/${id}/question`),
  setQuestion: (id: string, state: "open" | "settled" | "none", settledBy?: string) => call<Question | null>("PUT", `/api/objects/${id}/question`, { state, settledBy }),
  questions: () => call<QuestionsPage>("GET", "/api/questions"),
  thoughtAbout: (a: string, b: string) => call<{ id: string }>("POST", "/api/thoughts/about", { a, b }),
  garden: () => call<{ items: GardenItem[] }>("GET", "/api/garden"),
  dismissGarden: (id: string) => call<unknown>("POST", "/api/garden/dismiss", { id }),
  tags: () => call<TagRow[]>("GET", "/api/tags"),
  recolour: (id: number, color: string) => call<TagRow[]>("PATCH", `/api/tags/${id}`, { color }),
};

export const fieldOf = (o: { fields: Field[] }, key: string) => o.fields.find((f) => f.key === key);
/** A Thought without a title shows its first line. */
export const displayTitle = (o: Summary) => fieldOf(o, "title")?.value || o.firstLine || "Untitled";
export const TAG_COLORS = ["blue", "rose", "olive", "amber", "sky", "lilac", "green", "peach", "indigo"];
