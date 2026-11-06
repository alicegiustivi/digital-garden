export type Origin = "source" | "ai" | "owner";
export type OriginInfo = { origin: Origin; aiRole: string | null; aiModel: string | null; aiDate: string | null };
export type Field = { key: string; value: string } & OriginInfo;
export type Tag = { id: number; name: string; color: string } & OriginInfo;
export type Block = { id: number; text: string } & OriginInfo;
export type Summary = {
  id: string; type: string; private: boolean; unreviewed: boolean; hasImage: boolean; createdAt: string; updatedAt: string;
  fields: Field[]; firstLine: string; tags: Tag[]; connectionCount: number;
};
export type MentionInfo = { id: string; missing: boolean; type?: string; title?: string; private?: boolean; tags?: Tag[]; connectionCount?: number; inBin?: boolean; kind?: string | null; label?: string | null };
export type Obj = Summary & { blocks: Block[]; mentions?: Record<string, MentionInfo> };
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
export type TagRow = { id: number; name: string; color: string; count: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  types: () => call<Types>("GET", "/api/types"),
  list: (q: { type?: string; tag?: string; since?: string; unreviewed?: string } = {}) =>
    call<Summary[]>("GET", "/api/objects?" + new URLSearchParams(q as Record<string, string>)),
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
  tags: () => call<TagRow[]>("GET", "/api/tags"),
  recolour: (id: number, color: string) => call<TagRow[]>("PATCH", `/api/tags/${id}`, { color }),
};

export const fieldOf = (o: { fields: Field[] }, key: string) => o.fields.find((f) => f.key === key);
/** A Thought without a title shows its first line. */
export const displayTitle = (o: Summary) => fieldOf(o, "title")?.value || o.firstLine || "Untitled";
export const TAG_COLORS = ["blue", "rose", "olive", "amber", "sky", "lilac", "green", "peach", "indigo"];
