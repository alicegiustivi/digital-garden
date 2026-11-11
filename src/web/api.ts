export type Origin = "source" | "ai" | "owner";
export type OriginInfo = { origin: Origin; aiRole: string | null; aiModel: string | null; aiDate: string | null; /** An AI Suggestion the owner approved: still AI Origin, marked ✧. */ approved?: boolean; /** A fact looked up on the web (issue #108): the page it came from. */ sourceUrl?: string; sourceName?: string | null; sourceDate?: string | null };
export type Field = { key: string; value: string } & OriginInfo;
export type Tag = { id: number; name: string; color: string } & OriginInfo;
export type Block = { id: number; text: string } & OriginInfo;
export type Summary = {
  id: string; type: string; private: boolean; unreviewed: boolean; hasImage: boolean; /** Pictures on the Object's own image properties: property key -> file stem. */ images: Record<string, string>; portrait: string | null; createdAt: string; updatedAt: string;
  fields: Field[]; firstLine: string; tags: Tag[]; connectionCount: number;
};
export type PortraitBack = { stem: string; width: number | null; height: number | null } | null;
export type MentionInfo = { id: string; missing: boolean; type?: string; title?: string; private?: boolean; tags?: Tag[]; connectionCount?: number; portrait?: string | null; inBin?: boolean; kind?: string | null; label?: string | null };
export type Obj = Summary & {
  blocks: Block[]; mentions?: Record<string, MentionInfo>;
  typeAi?: { aiRole: string; aiModel: string; aiDate: string } | null; aiReadBeforePrivate?: string | null;
};
type SuggestionBase = { id: number; origin: "ai"; aiRole: string; aiModel: string; aiDate: string; approved: false };
export type Suggestion = SuggestionBase & (
  | { kind: "connection"; other: { id: string; type: string; title: string }; connectionKind: string; why?: string | null }
  | { kind: "type"; type: string; typeLabel: string }
  | { kind: "object"; type: string; typeLabel: string; name: string; tag?: string; count?: number }
  | { kind: "title"; title: string }
);
/** A value looked up on the web: Source Origin, with the page it came from. It waits for Approve or Not this. */
export type FactSuggestion = { id: number; kind: "fact"; origin: "source"; aiRole: null; aiModel: null; aiDate: string; approved: false; field: string; label: string; value: string; site: string; url: string; match: string; current: string | null };
export type Suggestions = { pending: (Suggestion | FactSuggestion)[]; rejected: number };
export type LookupInfo = { available: false; why: string } | { available: true; name: string; site: string; fields: string[] };
export type LookupResult = { status: "ok" | "choose" | "none" | "nothing-new" | "unavailable" | "offline" | "slow" | "limit" | "error"; message: string; count?: number; candidates?: { id: string; label: string; description: string; url: string; site: string }[] };
export type WebFound = { sources: { n: number; title: string; site: string; url: string; text: string }[]; notes: string[] };
export type AiNote = {
  id: number; kind: "summary" | "prompt" | "answer"; text: string;
  /** Objects named by links in the text (links to Objects that are gone were already dropped). */
  links?: Record<string, { type: string; title: string; private: boolean }>;
  /** Where a kept answer came from: the question, and whether its Inquiry is still here, in the Bin, or gone. */
  from?: { id: string; question: string; state: "here" | "bin" | "gone" } | null;
} & OriginInfo;
export type RemovedNote = { objectId: string; kind: string; text: string; aiRole: string; aiModel: string; aiDate: string; inquiryId?: string | null; question?: string | null };
export type Found = Summary & { title: string; connected: boolean };
export type Brief = { id: string; type: string; title: string; private: boolean; tags: Tag[]; connectionCount: number };
export type Connection = {
  id: number; other: Brief; kind: string; label: string; subject: boolean; note: string; sentence: string | null; sentenceBy: "other" | "me" | null; fromText: boolean;
} & OriginInfo;
export type KindChoice = { kind: string; subject: boolean; label: string };
export type Shares = Brief & { shared: string[]; sharedTags: string[] };
export type MergeAsk = { otherId: string; other: Brief; keep: { kind: string; label: string; note: string }; drop: { kind: string; label: string; note: string } };
export type FieldDef = { key: string; label: string; input: "text" | "longtext" | "select" | "rating" | "image"; options: string[] | null; lead?: boolean; /** "May be looked up": which fact from the web this property takes (issue #108), or a book's author / first year (Open Library). */ lookup?: "summary" | "year" | "link" | "authors" | "published" | null };
export type TypeDef = { key: string; label: string; plural: string; /** A palette colour key (src/shared/palette.ts). */ color: string; /** An icon key (src/web/icons.ts). */ icon: string; /** One of the four types that keep every special behaviour. */ core: boolean; /** Objects of this type, and how many more are in the Bin. */ count: number; inBin: number; fields: FieldDef[] };
export type Types = { types: TypeDef[]; fieldLabels: Record<string, FieldDef> };
export type TypesAnswer = Types & { key?: string; field?: string; moved?: number; removed?: { values: number; inBin: number } };
export type CaptureResult = { created: Obj[]; existing: Obj[]; thoughtId: string | null; openId: string };
export type BinRow = Summary & { title: string; deletedAt: string; daysLeft: number };
export type RemovedConnection = { fromId: string; toId: string; kind: string; note: string | null } & OriginInfo;
export type RemovedTag = { tag: TagRow; objects: number; turnedDown?: string[]; on: ({ objectId: string } & OriginInfo)[] };
export type AiSummary = {
  keySet: boolean; keyProblem: boolean; left: number; low: boolean; researcherLeft: number; waiting: number;
  budgets: { archivist: { used: number; limit: number }; researcher: { used: number; limit: number } };
  reset: { at: string; source: string }; models: string[];
};
export type AiRun = { id: number; model: string; at: string; facts: string[]; tags: string[]; connections: number };
export type AiStatus = { pending?: number; state: "none" | "private" | "waiting" | "working" | "busy" | "tomorrow" | "failed" | "done"; run: AiRun | null; canRun: boolean; nextTryAt?: string; needsKey?: boolean };
export type Filters = { type?: string; tag?: string; since?: string; until?: string; unreviewed?: string; noConnections?: string; sort?: string };
export type Hit = Summary & { title: string; match: { where: "title" | "tag" | "body" | "field" | "note" | "comment"; label: string; text: string; origin: OriginInfo } | null };
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
// The Researcher and Inquiries (issue #36)
export type Turn = {
  id: number; question: string; state: "waiting" | "working" | "busy" | "tomorrow" | "failed" | "cancelled" | "done";
  steps: { label: string; done: boolean }[]; error: string | null; nextTryAt?: string; tries?: number; maxTries: number; needsKey: boolean;
  answer: null | {
    text: string; links: Record<string, { type: string; title: string; private: boolean }>; reads: Brief3[]; kept: Brief3[];
    model: string; role: string; date: string; privateNote: string | null; web: WebFound | null;
  };
};
export type Thread = { id: string; object: Brief3 | null; scopeGone: boolean; createdAt: string; web: boolean; turns: Turn[] };
export type InquiryRow = { id: string; question: string; turns: number; state: Turn["state"]; createdAt: string; object: Brief3 | null; scopeGone: boolean };
export type BinInquiry = { id: string; question: string; deletedAt: string; daysLeft: number };
export type TagRow = { id: number; name: string; color: string; count: number };

export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
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
  undoAiConnection: (connId: number) => call<{ ok: true; objectIds: string[] }>("POST", `/api/connections/${connId}/undo-ai`),
  aiRun: (id: string) => call<AiStatus>("POST", `/api/objects/${id}/ai/run`),
  aiUndo: (id: string) => call<Obj>("POST", `/api/objects/${id}/ai/undo`),
  lookupInfo: (id: string) => call<LookupInfo>("GET", `/api/objects/${id}/lookup`),
  lookUp: (id: string, pick?: string) => call<LookupResult>("POST", `/api/objects/${id}/lookup`, pick ? { pick } : {}),
  suggestions: (id: string) => call<Suggestions>("GET", `/api/objects/${id}/suggestions`),
  approve: (sid: number) => call<Obj>("POST", `/api/suggestions/${sid}/approve`),
  reject: (sid: number) => call<unknown>("POST", `/api/suggestions/${sid}/reject`),
  forgetRejected: (id: string) => call<unknown>("POST", `/api/objects/${id}/ai/forget-rejected`),
  inquiries: () => call<InquiryRow[]>("GET", "/api/inquiries"),
  inquiriesAbout: (id: string) => call<InquiryRow[]>("GET", `/api/objects/${id}/inquiries`),
  inquiry: (id: string) => call<Thread>("GET", `/api/inquiries/${id}`),
  ask: (question: string, objectId?: string, web?: boolean) => call<Thread>("POST", "/api/inquiries", { question, objectId, web: web === true }),
  askAgain: (inquiryId: string, question: string) => call<Thread>("POST", `/api/inquiries/${inquiryId}/turns`, { question }),
  deleteInquiry: (id: string) => call<unknown>("DELETE", `/api/inquiries/${id}`),
  restoreInquiry: (id: string) => call<unknown>("POST", `/api/inquiries/${id}/restore`),
  binInquiries: () => call<BinInquiry[]>("GET", "/api/bin/inquiries"),
  purgeInquiry: (id: string) => call<unknown>("DELETE", `/api/bin/inquiries/${id}`),
  cancelTurn: (id: number) => call<unknown>("POST", `/api/turns/${id}/cancel`),
  retryTurn: (id: number) => call<unknown>("POST", `/api/turns/${id}/retry`),
  keepTurn: (id: number, objectIds: string[]) => call<{ kept: Brief3[] }>("POST", `/api/turns/${id}/keep`, { objectIds }),
  thoughtFromTurn: (id: number) => call<{ id: string }>("POST", `/api/turns/${id}/thought`),
  aiNotes: (id: string) => call<AiNote[]>("GET", `/api/objects/${id}/ai-notes`),
  deleteAiNote: (nid: number) => call<{ was: RemovedNote }>("DELETE", `/api/ai-notes/${nid}`),
  restoreAiNote: (n: RemovedNote) => call<unknown>("POST", "/api/ai-notes/restore", n),
  thoughtFromNote: (nid: number) => call<Obj>("POST", `/api/ai-notes/${nid}/thought`),
  types: () => call<Types>("GET", "/api/types"),
  // The owner shaping Object Types (issue #107). Each answer is the whole list again.
  createType: (b: { label: string; plural?: string; color: string; icon: string }) => call<TypesAnswer>("POST", "/api/types", b),
  updateType: (key: string, b: { label?: string; plural?: string; color?: string; icon?: string }) => call<TypesAnswer>("PATCH", `/api/types/${key}`, b),
  orderTypes: (keys: string[]) => call<TypesAnswer>("PUT", "/api/types/order", { keys }),
  moveTypeObjects: (key: string, to: string) => call<TypesAnswer>("POST", `/api/types/${key}/move`, { to }),
  deleteType: (key: string) => call<TypesAnswer>("DELETE", `/api/types/${key}`),
  addTypeField: (key: string, b: { label: string; input: string; options?: string[]; lead?: boolean; lookup?: string }) => call<TypesAnswer>("POST", `/api/types/${key}/fields`, b),
  updateTypeField: (key: string, field: string, b: { label?: string; options?: string[]; lead?: boolean; lookup?: string }) => call<TypesAnswer>("PATCH", `/api/types/${key}/fields/${field}`, b),
  orderTypeFields: (key: string, keys: string[]) => call<TypesAnswer>("PUT", `/api/types/${key}/fields/order`, { keys }),
  typeFieldRemoval: (key: string, field: string) => call<{ values: number; inBin: number }>("GET", `/api/types/${key}/fields/${field}/removal`),
  removeTypeField: (key: string, field: string) => call<TypesAnswer>("DELETE", `/api/types/${key}/fields/${field}`),
  list: (q: Filters = {}) => call<Summary[]>("GET", "/api/objects?" + params(q)),
  find: (q: Filters & { q?: string; limit?: number }) => call<FindResult>("GET", "/api/find?" + params(q)),
  recent: (ids: string[]) => call<Hit[]>("GET", "/api/recent?ids=" + ids.join(",")),
  timeline: (before?: string) => call<{ events: TimelineEvent[]; next: string | null }>("GET", "/api/timeline?" + params({ before, limit: 120 })),
  renameTag: (id: number, name: string) => call<RenamedTag>("POST", `/api/tags/${id}/rename`, { name }),
  undoRename: (id: number, was: RenamedTag["was"]) => call<TagRow[]>("POST", `/api/tags/${id}/rename/undo`, was),
  mergeTag: (id: number, into: number) => call<MergedTag>("POST", `/api/tags/${id}/merge`, { into }),
  undoMerge: (m: MergedTag["merged"]) => call<TagRow[]>("POST", "/api/tags/unmerge", m),
  capture: async (c: { text: string; links: string[]; images: File[]; private: boolean; type?: string | null }): Promise<CaptureResult> => {
    const payload = JSON.stringify({ text: c.text, links: c.links, private: c.private, type: c.type || undefined });
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
  // A Person's Portrait (issue #69). Each answer carries "previous", what Undo sets back.
  setPortrait: async (id: string, file: File): Promise<Obj & { previous: PortraitBack }> => {
    const form = new FormData();
    form.set("image", file, file.name || "Portrait");
    const res = await fetch(`/api/objects/${id}/portrait`, { method: "PUT", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
  // A picture on an image property of a type of the owner's own (ADR 0010). Each answer carries "previous", what Undo sets back.
  setPropImage: async (id: string, field: string, file: File): Promise<Obj & { previous: { stem: string; width: number | null; height: number | null } | null }> => {
    const form = new FormData();
    form.set("image", file, file.name || "Picture");
    const res = await fetch(`/api/objects/${id}/images/${field}`, { method: "PUT", body: form });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
    return res.json();
  },
  removePropImage: (id: string, field: string) => call<Obj & { previous: { stem: string; width: number | null; height: number | null } | null }>("DELETE", `/api/objects/${id}/images/${field}`),
  restorePropImage: (id: string, field: string, back: { stem: string; width: number | null; height: number | null } | null) => call<Obj & { previous: { stem: string; width: number | null; height: number | null } | null }>("POST", `/api/objects/${id}/images/${field}/restore`, { back }),
  removePortrait: (id: string) => call<Obj & { previous: PortraitBack }>("DELETE", `/api/objects/${id}/portrait`),
  restorePortrait: (id: string, back: PortraitBack) => call<Obj & { previous: PortraitBack }>("POST", `/api/objects/${id}/portrait/restore`, { back }),
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

// The Daily Inbox (issue #37)
export type InboxStatus = {
  folder: string | null; lastSync: string | null; waiting: number;
  warning: { kind: "unset" | "missing" | "stale"; text: string } | null;
  days: { day: string; count: number; failed: number }[];
};
export type InboxEntry = {
  id: number; at: string; status: "done" | "failed"; reason: string | null; refused: boolean; private: boolean;
  comment: string | null; thought: { id: string; title: string } | null; objects: Summary[];
};
export type InboxComment = { captureId: number; day: string; at: string; comment: string } | null;
export const inboxApi = {
  inbox: () => call<InboxStatus>("GET", "/api/inbox"),
  phoneSetup: () => call<{ code: string }>("GET", "/api/inbox/setup"),
  phoneNewCode: () => call<{ code: string }>("POST", "/api/inbox/setup/new-code"),
  inboxScan: () => call<InboxStatus & { taken: number; failed: number }>("POST", "/api/inbox/scan"),
  inboxFolder: (path: string) => call<InboxStatus>("PUT", "/api/inbox/folder", { path }),
  inboxDay: (day: string) => call<{ day: string; entries: InboxEntry[] }>("GET", `/api/inbox/days/${day}`),
  inboxOf: (ids: string[]) => call<Record<string, string>>("GET", `/api/inbox/of?ids=${ids.join(",")}`),
  inboxComment: (id: string) => call<InboxComment>("GET", `/api/objects/${id}/inbox`),
  inboxEdit: (captureId: number, comment: string) => call<{ comment: string | null }>("PATCH", `/api/inbox/captures/${captureId}`, { comment }),
  inboxThought: (captureId: number) => call<{ id: string }>("POST", `/api/inbox/captures/${captureId}/thought`),
  inboxRetry: (captureId: number) => call<{ outcome: string; reason?: string }>("POST", `/api/inbox/captures/${captureId}/retry`),
  inboxReveal: (captureId: number) => call<unknown>("POST", `/api/inbox/captures/${captureId}/reveal`),
};

// The Map (issue #82)
export type GraphNode = { id: string; type: string; title: string; private: boolean; tags: string[]; created: string; changed: string };
export type GraphEdge = { id: number; from: string; to: string; kind: string; origin: string; approved: boolean };
export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };
export const fetchGraph = () => call<GraphData>("GET", "/api/graph");
