import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { canonicalLink } = await import("../src/server/links.ts");

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
let read: { id: string; url: string }[];
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  read = [];
  app = createApp(sqlite, { readLink: (id, url) => read.push({ id, url }) });
});

const cap = async (body: unknown) => {
  const res = await app.request("/api/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const upload = async (payload: unknown, files: { name: string; data: Buffer }[]) => {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const f of files) form.append("images", new File([new Uint8Array(f.data)], f.name));
  const res = await app.request("/api/capture", { method: "POST", body: form });
  return { status: res.status, json: (await res.json()) as any };
};
const field = (o: any, k: string) => o.fields.find((f: any) => f.key === k);

describe("Capture of text", () => {
  it("saves typed words as an Unreviewed Thought in the owner's words", async () => {
    const r = await cap({ text: "Walking helps me think.\n\nEspecially alone." });
    expect(r.status).toBe(201);
    const t = r.json.created[0];
    expect(t.type).toBe("thought");
    expect(t.unreviewed).toBe(true);
    expect(t.private).toBe(false);
    expect(t.blocks.map((b: any) => [b.text, b.origin])).toEqual([["Walking helps me think.", "owner"], ["Especially alone.", "owner"]]);
    expect(r.json.openId).toBe(t.id);
  });
  it("stores a Private capture as Private, and nothing else as Private", async () => {
    expect((await cap({ text: "secret", private: true })).json.created[0].private).toBe(true);
    expect((await cap({ text: "open", private: "yes" })).json.created[0].private).toBe(false);
  });
  it("refuses an empty capture", async () => {
    expect((await cap({ text: "  \n " })).status).toBe(400);
  });
  it("is on disk the moment it is saved", async () => {
    const r = await cap({ text: "kept" });
    expect((sqlite.prepare("SELECT text FROM blocks WHERE object_id = ?").get(r.json.created[0].id) as any).text).toBe("kept");
  });
});

describe("Capture of links", () => {
  it("saves a link at once as an Unreviewed Source marked 'reading', then asks for it to be read", async () => {
    const r = await cap({ links: ["https://example.com/a?utm_source=x#top"], private: true });
    const s = r.json.created[0];
    expect(s.type).toBe("source");
    expect(s.unreviewed).toBe(true);
    expect(s.private).toBe(true);
    expect(field(s, "link")).toMatchObject({ value: "https://example.com/a", origin: "source" });
    expect(field(s, "extraction").value).toBe("reading");
    expect(read).toEqual([{ id: s.id, url: "https://example.com/a" }]);
  });
  it("opens the existing Source instead of making a copy", async () => {
    const a = await cap({ links: ["https://example.com/a"] });
    const b = await cap({ links: ["https://EXAMPLE.com/a/?utm_medium=y"], text: "again" });
    expect(b.json.created).toHaveLength(0);
    expect(b.json.existing[0].id).toBe(a.json.created[0].id);
    expect(b.json.openId).toBe(a.json.created[0].id);
    expect(sqlite.prepare("SELECT count(*) n FROM objects").get()).toEqual({ n: 1 });
    expect(read).toHaveLength(1);
  });
  it("one link takes the words as its body", async () => {
    const s = (await cap({ links: ["https://example.com/a"], text: "Worth rereading." })).json.created[0];
    expect(s.blocks.map((b: any) => [b.text, b.origin])).toEqual([["Worth rereading.", "owner"]]);
  });
  it("several links become one Source each, and the words a Thought that mentions them all", async () => {
    const r = await cap({ links: ["https://a.example/1", "https://b.example/2"], text: "Both say the same." });
    expect(r.json.created.map((o: any) => o.type)).toEqual(["source", "source", "thought"]);
    const thought = r.json.created[2];
    expect(r.json.openId).toBe(thought.id);
    expect(thought.blocks[0]).toMatchObject({ text: "Both say the same.", origin: "owner" });
    expect(r.json.created[0].blocks).toHaveLength(0);
    const rows = sqlite.prepare("SELECT kind, origin FROM connections WHERE from_id = ?").all(thought.id);
    expect(rows).toEqual([{ kind: "mentions", origin: "owner" }, { kind: "mentions", origin: "owner" }]);
  });
  it("refuses something that is not a web link", async () => {
    expect((await cap({ links: ["javascript:alert(1)"] })).status).toBe(400);
  });
  it("tidies links the same way every time", () => {
    expect(canonicalLink("https://Example.com/path/?b=2&a=1&fbclid=z#x")).toBe("https://example.com/path?a=1&b=2");
    expect(canonicalLink("https://example.com/")).toBe("https://example.com");
  });
});

describe("Capture of images", () => {
  let png: Buffer, big: Buffer, heic: Buffer;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "garden-fixture-"));
    const tiny = join(dir, "tiny.png");
    writeFileSync(tiny, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
    png = readFileSync(tiny);
    const bigFile = join(dir, "big.png");
    execFileSync("/usr/bin/sips", ["-z", "3000", "4000", tiny, "--out", bigFile]);
    big = readFileSync(bigFile);
    const h = join(dir, "photo.heic");
    execFileSync("/usr/bin/sips", ["-s", "format", "heic", bigFile, "--out", h]);
    heic = readFileSync(h);
  });

  it("shrinks a big photo to about 2048 px and keeps a thumbnail, never the original", async () => {
    const r = await upload({}, [{ name: "Holiday.PNG", data: big }]);
    expect(r.status).toBe(201);
    const s = r.json.created[0];
    expect(s.hasImage).toBe(true);
    expect(field(s, "format").value).toBe("image");
    expect(field(s, "title").value).toBe("Holiday");
    const dir = join(process.env.GARDEN_DIR!, "images");
    const files = readdirSync(dir).filter((f) => f.startsWith(s.id));
    expect(files.sort()).toEqual([`${s.id}.jpg`, `${s.id}.thumb.jpg`]);
    const dims = (f: string) => execFileSync("/usr/bin/sips", ["-g", "pixelWidth", join(dir, f)]).toString().match(/(\d+)\s*$/)![1];
    expect(Number(dims(`${s.id}.jpg`))).toBe(2048);
    expect(Number(dims(`${s.id}.thumb.jpg`))).toBe(400);
    const got = await app.request(`/api/images/${s.id}/thumb`);
    expect(got.headers.get("content-type")).toBe("image/jpeg");
  });
  it("reads an iPhone HEIC photo", async () => {
    const r = await upload({}, [{ name: "IMG_0001.HEIC", data: heic }]);
    expect(r.status).toBe(201);
    expect(existsSync(join(process.env.GARDEN_DIR!, "images", `${r.json.created[0].id}.jpg`))).toBe(true);
  });
  it("one image takes the words as its body; several images become Sources plus a Thought", async () => {
    const one = await upload({ text: "My desk." }, [{ name: "a.png", data: png }]);
    expect(one.json.created[0].blocks[0]).toMatchObject({ text: "My desk.", origin: "owner" });
    const many = await upload({ text: "Two desks.", private: true }, [{ name: "a.png", data: png }, { name: "b.png", data: png }]);
    expect(many.json.created.map((o: any) => o.type)).toEqual(["source", "source", "thought"]);
    expect(many.json.created.every((o: any) => o.private)).toBe(true);
  });
  it("saves nothing when a picture can't be read", async () => {
    const r = await upload({ text: "hello" }, [{ name: "a.png", data: png }, { name: "bad.png", data: Buffer.from("not a picture") }]);
    expect(r.status).toBe(400);
    expect(sqlite.prepare("SELECT count(*) n FROM objects").get()).toEqual({ n: 0 });
  });
});
