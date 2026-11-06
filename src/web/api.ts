export type Origin = "source" | "ai" | "owner";
export type OriginInfo = { origin: Origin; aiRole: string | null; aiModel: string | null; aiDate: string | null };
export type Field = { key: string; value: string } & OriginInfo;
export type Tag = { id: number; name: string; color: string } & OriginInfo;
export type Block = { id: number; text: string } & OriginInfo;
export type Summary = {
  id: string; type: string; private: boolean; unreviewed: boolean; createdAt: string; updatedAt: string;
  fields: Field[]; firstLine: string; tags: Tag[]; connectionCount: number;
};
export type Obj = Summary & { blocks: Block[] };
export type FieldDef = { key: string; label: string; input: "text" | "longtext" | "select"; options: string[] | null; lead?: boolean };
export type TypeDef = { key: string; label: string; plural: string; fields: FieldDef[] };
export type Types = { types: TypeDef[]; fieldLabels: Record<string, FieldDef> };
export type TagRow = { id: number; name: string; color: string; count: number };

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export const api = {
  types: () => call<Types>("GET", "/api/types"),
  list: (q: { type?: string; tag?: string; since?: string } = {}) =>
    call<Summary[]>("GET", "/api/objects?" + new URLSearchParams(q as Record<string, string>)),
  capture: (text: string, isPrivate: boolean) => call<Obj>("POST", "/api/capture", { text, private: isPrivate }),
  get: (id: string) => call<Obj>("GET", `/api/objects/${id}`),
  create: (type: string) => call<Obj>("POST", "/api/objects", { type }),
  patch: (id: string, patch: { type?: string; private?: boolean; fields?: Record<string, string | null> }) =>
    call<Obj>("PATCH", `/api/objects/${id}`, patch),
  setBody: (id: string, paragraphs: string[]) => call<Obj>("PUT", `/api/objects/${id}/body`, { paragraphs }),
  addTag: (id: string, name: string) => call<Obj>("POST", `/api/objects/${id}/tags`, { name }),
  removeTag: (id: string, tagId: number) => call<Obj>("DELETE", `/api/objects/${id}/tags/${tagId}`),
  tags: () => call<TagRow[]>("GET", "/api/tags"),
  recolour: (id: number, color: string) => call<TagRow[]>("PATCH", `/api/tags/${id}`, { color }),
};

export const fieldOf = (o: { fields: Field[] }, key: string) => o.fields.find((f) => f.key === key);
/** A Thought without a title shows its first line. */
export const displayTitle = (o: Summary) => fieldOf(o, "title")?.value || o.firstLine || "Untitled";
export const TAG_COLORS = ["blue", "rose", "olive", "amber", "sky", "lilac", "green", "peach", "indigo"];
