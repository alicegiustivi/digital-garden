// More kinds of property for a type the owner made (ADR 0010): a rating, a picture, and an author / first year from the web.
import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-kinds-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createWebGate } = await import("../src/server/web-gate.ts");
const { archivistPrompt } = await import("../src/server/ai-prompt.ts");
const { statedProps } = await import("../src/server/archivist.ts");
const { purgeObjects } = await import("../src/server/bin.ts");
const { bringBack } = await import("../src/server/bring-back.ts");
const ex = await import("../src/server/export.ts");
const { imagesDir } = await import("../src/server/paths.ts");

let png: Buffer;
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "garden-fixture-"));
  const tiny = join(dir, "tiny.png");
  writeFileSync(tiny, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  const big = join(dir, "cover.png");
  execFileSync("/usr/bin/sips", ["-z", "900", "600", tiny, "--out", big]);
  png = readFileSync(big);
});

const BOOKS: Record<string, any[]> = { "the dispossessed": [{ key: "/works/OL1W", title: "The Dispossessed", author_name: ["Ursula K. Le Guin"], first_publish_year: 1974 }] };
let urls: string[];
const fakeFetch = (async (url: string) => {
  urls.push(String(url));
  const u = new URL(String(url));
  if (u.hostname === "openlibrary.org") return new Response(JSON.stringify({ docs: BOOKS[(u.searchParams.get("title") ?? "").toLowerCase()] ?? [] }));
  return new Response("{}", { status: 404 });
}) as unknown as typeof fetch;

let sqlite: ReturnType<typeof openDb>["sqlite"], app: ReturnType<typeof createApp>;
beforeEach(() => {
  rmSync(imagesDir(), { recursive: true, force: true }); mkdirSync(imagesDir(), { recursive: true });
  sqlite = openDb(":memory:").sqlite; urls = [];
  app = createApp(sqlite, { readLink: () => {}, web: createWebGate({ fetch: fakeFetch }) });
});
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const setup = async () => {
  const k = (await call("POST", "/api/types", { label: "Book", color: "teal", icon: "book" })).json.key as string;
  const field = async (label: string, input: string, extra: object = {}) => (await call("POST", `/api/types/${k}/fields`, { label, input, ...extra })).json.field as string;
  return { k, field };
};
const putPic = async (id: string, field: string) => {
  const form = new FormData(); form.set("image", new File([new Uint8Array(png)], "cover.png"));
  const res = await app.request(`/api/objects/${id}/images/${field}`, { method: "PUT", body: form });
  return { status: res.status, json: (await res.json()) as any };
};
const pics = (id: string) => readdirSync(imagesDir()).filter((f) => f.startsWith(`pimg-${id}-`)).sort();

describe("rating", () => {
  it("is a property of 1 to 5 stars the owner sets and clears; the screen sees it as its own kind", async () => {
    const { k, field } = await setup();
    const r = await field("Rating", "rating");
    const t = (await call("GET", "/api/types")).json.types.find((x: any) => x.key === k);
    expect(t.fields[0]).toMatchObject({ key: r, label: "Rating", input: "rating", lookup: null });
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    expect((await call("PATCH", `/api/objects/${id}`, { fields: { [r]: "4" } })).json.fields.find((f: any) => f.key === r)).toMatchObject({ value: "4", origin: "owner" });
    expect((await call("PATCH", `/api/objects/${id}`, { fields: { [r]: "6" } })).status).toBe(400);
    expect((await call("PATCH", `/api/objects/${id}`, { fields: { [r]: "four" } })).status).toBe(400);
    expect((await call("PATCH", `/api/objects/${id}`, { fields: { [r]: "" } })).json.fields.find((f: any) => f.key === r)).toBeUndefined();
  });
  it("cannot be the property shown under the title, and cannot be filled from the web", async () => {
    const { k, field } = await setup();
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Rating", input: "rating", lead: true })).status).toBe(400);
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Rating", input: "rating", lookup: "summary" })).status).toBe(400);
    const r = await field("Rating", "rating");
    expect((await call("PATCH", `/api/types/${k}/fields/${r}`, { lead: true })).status).toBe(400);
  });
  it("is the owner's opinion: the Archivist is never offered it and never writes it", async () => {
    const { k, field } = await setup();
    const r = await field("Rating", "rating"), a = await field("Author", "text");
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    const prompt = archivistPrompt(sqlite, id)!.messages.map((m: any) => (typeof m.content === "string" ? m.content : "")).join("\n");
    expect(prompt).toContain(`${a}: Author`);
    expect(prompt).not.toContain(`${r}: Rating`);
    await call("PUT", `/api/objects/${id}/body`, { paragraphs: ["5 stars, by Frank Herbert"] });
    expect(statedProps(sqlite, id, k, { [r]: "5", [a]: "Frank Herbert" })).toEqual({ [a]: "Frank Herbert" });
  });
});

describe("picture", () => {
  it("is added by the owner, shrunk, shown by the Object, replaced with Undo, and removed with Undo", async () => {
    const { k, field } = await setup();
    const p = await field("Cover", "image");
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    const a = await putPic(id, p);
    expect(a.status).toBe(200);
    expect(a.json.images[p]).toMatch(/^pimg-/);
    expect(a.json.previous).toBeNull();
    expect(pics(id)).toHaveLength(2); // the picture and its thumbnail
    const res = await app.request(`/api/prop-images/${a.json.images[p]}/thumb`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const b = await putPic(id, p);
    expect(b.json.previous.stem).toBe(a.json.images[p]);
    expect(pics(id)).toHaveLength(4); // the old one is kept for Undo
    const undone = await call("POST", `/api/objects/${id}/images/${p}/restore`, { back: b.json.previous });
    expect(undone.json.images[p]).toBe(a.json.images[p]);
    const gone = await call("DELETE", `/api/objects/${id}/images/${p}`);
    expect(gone.json.images).toEqual({});
    const back = await call("POST", `/api/objects/${id}/images/${p}/restore`, { back: gone.json.previous });
    expect(back.json.images[p]).toBe(a.json.images[p]);
  });
  it("is never typed as a value, never offered to an AI, and only works on a picture property of this Object", async () => {
    const { k, field } = await setup();
    const p = await field("Cover", "image"), t = await field("Author", "text");
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    expect((await call("PATCH", `/api/objects/${id}`, { fields: { [p]: "x" } })).status).toBe(400);
    expect((await putPic(id, t)).status).toBe(400); // a text property
    expect((await putPic(id, "c-0000000000")).status).toBe(400);
    expect((await putPic("00000000-0000-0000-0000-000000000000", p)).status).toBe(404);
    await putPic(id, p);
    const prompt = archivistPrompt(sqlite, id)!.messages.map((m: any) => (typeof m.content === "string" ? m.content : "")).join("\n");
    expect(prompt).not.toMatch(/pimg-|Cover/);
    expect(sqlite.prepare("SELECT count(*) AS n FROM field_values WHERE field = ?").get(p)).toEqual({ n: 0 }); // not a field value, so not searched either
  });
  it("goes with the Object when the Bin is emptied, and when the property is removed", async () => {
    const { k, field } = await setup();
    const p = await field("Cover", "image");
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    await putPic(id, p);
    expect((await call("GET", `/api/types/${k}/fields/${p}/removal`)).status).toBe(200);
    await call("DELETE", `/api/objects/${id}`);
    purgeObjects(sqlite, [id]);
    await new Promise((r) => setTimeout(r, 100));
    expect(pics(id)).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM property_images").get()).toEqual({ n: 0 });
  });
  it("is in Export (the file and the property's name) and comes back with 'bring back one thing'", async () => {
    const { k, field } = await setup();
    const p = await field("Cover", "image");
    const id = (await call("POST", "/api/objects", { type: k, title: "Dune" })).json.id;
    const a = await putPic(id, p);
    const g = ex.gatherGarden(sqlite, {}, new Date("2026-11-11T10:00:00"));
    expect(g.objects[0].propertyImages).toEqual([expect.objectContaining({ field: p, label: "Cover", file: `${a.json.images[p]}.jpg`, origin: "owner" })]);
    // bring it back from a spare copy into an empty Garden
    const live = openDb(":memory:").sqlite;
    const spareImages = imagesDir(), liveImages = mkdtempSync(join(tmpdir(), "li-"));
    const r: any = bringBack(sqlite, live, "2026-11-11", id, { spareImages, liveImages });
    expect(r.status).toBe("brought-back");
    expect(live.prepare("SELECT stem FROM property_images WHERE object_id = ?").get(id)).toEqual({ stem: a.json.images[p] });
    expect(readdirSync(liveImages).filter((f) => f.startsWith("pimg-"))).toHaveLength(2);
  });
});

describe("author and first year from the web", () => {
  it("a property marked 'a book's author' makes the type's Objects look up as books, and the answer waits as a Suggestion", async () => {
    const { k, field } = await setup();
    const a = await field("Author", "text", { lookup: "authors" });
    const y = await field("First published", "text", { lookup: "published" });
    const t = (await call("GET", "/api/types")).json.types.find((x: any) => x.key === k);
    expect(t.fields.map((f: any) => f.lookup)).toEqual(["authors", "published"]);
    const id = (await call("POST", "/api/objects", { type: k, title: "The Dispossessed" })).json.id;
    const r = await call("POST", `/api/objects/${id}/lookup`, {});
    expect(r.json.status).toBe("ok");
    expect(urls).toHaveLength(1);
    expect(new URL(urls[0]).hostname).toBe("openlibrary.org");
    expect(new URL(urls[0]).searchParams.get("title")).toBe("The Dispossessed"); // only the title leaves
    const s = (await call("GET", `/api/objects/${id}/suggestions`)).json.pending.filter((x: any) => x.kind === "fact");
    expect(s.map((x: any) => [x.field ?? x.data?.field, x.value ?? x.data?.value]).sort()).toEqual([[a, "Ursula K. Le Guin"], [y, "1974"]].sort());
    expect(sqlite.prepare("SELECT count(*) AS n FROM field_values WHERE object_id = ?").get(id)).toEqual({ n: 1 }); // nothing written until approved (only the title)
  });
  it("only a text can take it", async () => {
    const { k } = await setup();
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Shelf", input: "select", options: ["a", "b"], lookup: "authors" })).status).toBe(400);
    expect((await call("POST", `/api/types/${k}/fields`, { label: "Cover", input: "image", lookup: "authors" })).status).toBe(400);
  });
});
