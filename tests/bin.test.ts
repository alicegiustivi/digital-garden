import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  app = createApp(sqlite);
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title?: string) => (await call("POST", "/api/objects", { type, title })).json;
const tok = (o: any) => `[[o:${o.id}]]`;
const body = (o: any, ...p: string[]) => call("PUT", `/api/objects/${o.id}/body`, { paragraphs: p });
const count = (sql: string, ...a: any[]) => (sqlite.prepare(sql).get(...a) as any).n as number;

describe("the Bin", () => {
  it("hides a deleted Object everywhere and restores it exactly, Connections included", async () => {
    const a = await make("source", "Walden"), b = await make("thought", "On quiet");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "nature" });
    await body(a, "Words by the pond.");
    await call("POST", "/api/connections", { a: a.id, b: b.id, kind: "supports", note: "same mood" });
    const before = (await call("GET", `/api/objects/${a.id}`)).json;

    expect((await call("DELETE", `/api/objects/${a.id}`)).status).toBe(200);
    expect((await call("GET", `/api/objects/${a.id}`)).status).toBe(404);
    expect((await call("GET", "/api/objects")).json.map((x: any) => x.id)).toEqual([b.id]);
    expect((await call("GET", "/api/search?q=walden")).json).toEqual([]);
    expect((await call("GET", `/api/objects/${b.id}/connections`)).json).toEqual([]); // kept but hidden
    expect(count("SELECT count(*) AS n FROM connections")).toBe(1);
    expect((await call("GET", "/api/tags")).json[0].count).toBe(0);

    const bin = (await call("GET", "/api/bin")).json;
    expect(bin).toMatchObject([{ id: a.id, title: "Walden", daysLeft: 30, connectionCount: 1 }]);

    expect((await call("POST", `/api/objects/${a.id}/restore`)).status).toBe(200);
    expect((await call("GET", `/api/objects/${a.id}`)).json).toEqual(before);
    const conns = (await call("GET", `/api/objects/${b.id}/connections`)).json;
    expect(conns).toMatchObject([{ kind: "supports", note: "same mood", other: { id: a.id } }]);
    expect((await call("GET", "/api/bin")).json).toEqual([]);
  });

  it("makes a Mention of a deleted Object read 'in the Bin', and restoring brings it back", async () => {
    const s = await make("source", "Walden"), t = await make("thought");
    await body(t, `See ${tok(s)} here.`);
    await call("DELETE", `/api/objects/${s.id}`);
    expect((await call("GET", `/api/objects/${t.id}`)).json.mentions[s.id]).toMatchObject({ missing: true, inBin: true });
    await call("POST", `/api/objects/${s.id}/restore`);
    expect((await call("GET", `/api/objects/${t.id}`)).json.mentions[s.id]).toMatchObject({ missing: false, title: "Walden" });
    expect((await call("GET", `/api/objects/${t.id}/connections`)).json).toMatchObject([{ kind: "mentions" }]);
  });

  it("empties the Bin for good: Connections go, Mentions read missing, not 'in the Bin'", async () => {
    const s = await make("source", "Walden"), t = await make("thought"), keep = await make("person", "Ann");
    await body(t, `See ${tok(s)} here.`);
    await call("POST", "/api/connections", { a: s.id, b: keep.id });
    await call("DELETE", `/api/objects/${s.id}`);
    expect((await call("POST", "/api/bin/empty")).json).toEqual({ purged: 1 });
    expect(count("SELECT count(*) AS n FROM objects WHERE id = ?", s.id)).toBe(0);
    expect(count("SELECT count(*) AS n FROM connections")).toBe(0);
    expect((await call("GET", `/api/objects/${t.id}`)).json.mentions[s.id]).toMatchObject({ missing: true, inBin: false });
    expect((await call("POST", `/api/objects/${s.id}/restore`)).status).toBe(404);
  });

  it("leaves Objects that are not in the Bin alone, and removes one by itself", async () => {
    const a = await make("thought", "keep"), b = await make("thought", "toss");
    expect((await call("DELETE", `/api/bin/${a.id}`)).status).toBe(404);
    await call("DELETE", `/api/objects/${b.id}`);
    expect((await call("DELETE", `/api/bin/${b.id}`)).status).toBe(200);
    expect((await call("GET", `/api/objects/${a.id}`)).status).toBe(200);
  });

  it("removes anything that has been in the Bin 30 days", async () => {
    const old = await make("thought", "old"), recent = await make("thought", "recent");
    await call("DELETE", `/api/objects/${old.id}`);
    await call("DELETE", `/api/objects/${recent.id}`);
    sqlite.prepare("UPDATE objects SET deleted_at = datetime('now', '-31 days') WHERE id = ?").run(old.id);
    sqlite.prepare("UPDATE objects SET deleted_at = datetime('now', '-29 days') WHERE id = ?").run(recent.id);
    const bin = (await call("GET", "/api/bin")).json;
    expect(bin.map((x: any) => x.id)).toEqual([recent.id]);
    expect(bin[0].daysLeft).toBe(1);
  });
});

describe("Undo for small removals", () => {
  it("puts back a removed Connection with its kind, note and Origin", async () => {
    const a = await make("source", "A"), b = await make("thought", "B");
    const c = (await call("POST", "/api/connections", { a: a.id, b: b.id, kind: "contradicts", note: "hm" })).json;
    const removed = (await call("DELETE", `/api/connections/${c.id}`)).json;
    expect(count("SELECT count(*) AS n FROM connections")).toBe(0);
    expect((await call("POST", "/api/connections/restore", removed.was)).status).toBe(201);
    expect(sqlite.prepare("SELECT from_id, to_id, kind, note, origin FROM connections").all()).toEqual([
      { from_id: a.id, to_id: b.id, kind: "contradicts", note: "hm", origin: "owner" },
    ]);
  });

  it("puts a Tag back on one Object, keeping an AI Tag's Origin", async () => {
    const a = await make("thought", "A");
    const withTag = (await call("POST", `/api/objects/${a.id}/tags`, { name: "x" })).json;
    const tag = withTag.tags[0];
    sqlite.prepare("UPDATE object_tags SET origin = 'ai', ai_role = 'archivist', ai_model = 'm', ai_date = '2026-01-01'").run();
    await call("DELETE", `/api/objects/${a.id}/tags/${tag.id}`);
    const origin = { origin: "ai", aiRole: "archivist", aiModel: "m", aiDate: "2026-01-01" };
    const back = (await call("POST", `/api/objects/${a.id}/tags/${tag.id}/restore`, origin)).json;
    expect(back.tags).toMatchObject([{ name: "x", origin: "ai", aiRole: "archivist" }]);
  });

  it("removes a Tag from the whole Garden and Undo brings it back on every Object", async () => {
    const a = await make("thought", "A"), b = await make("thought", "B");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "x" });
    await call("POST", `/api/objects/${b.id}/tags`, { name: "x" });
    const tag = (await call("GET", "/api/tags")).json[0];
    const gone = (await call("DELETE", `/api/tags/${tag.id}`)).json;
    expect(gone.objects).toBe(2);
    expect((await call("GET", "/api/tags")).json).toEqual([]);
    expect((await call("GET", `/api/objects/${a.id}`)).json.tags).toEqual([]);
    await call("POST", "/api/tags/restore", gone);
    expect((await call("GET", "/api/tags")).json).toMatchObject([{ id: tag.id, name: "x", color: tag.color, count: 2 }]);
  });

  it("removing a Tag works on a Private Object and leaves every Object itself unchanged", async () => {
    const a = await make("thought", "Secret"), b = await make("thought", "B");
    sqlite.prepare("UPDATE objects SET private = 1 WHERE id = ?").run(a.id);
    await call("POST", `/api/objects/${a.id}/tags`, { name: "x" });
    await call("POST", `/api/objects/${b.id}/tags`, { name: "x" });
    const before = sqlite.prepare("SELECT id, type, title, private, updated_at FROM objects ORDER BY id").all();
    const tag = (await call("GET", "/api/tags")).json[0];
    expect((await call("DELETE", `/api/tags/${tag.id}`)).json.objects).toBe(2);
    expect(count("SELECT count(*) AS n FROM object_tags")).toBe(0);
    expect(sqlite.prepare("SELECT id, type, title, private, updated_at FROM objects ORDER BY id").all()).toEqual(before);
  });

  it("remembers a removed AI Tag as turned down, not an owner Tag, and Undo forgets it", async () => {
    const a = await make("thought", "A"), b = await make("thought", "B");
    await call("POST", `/api/objects/${a.id}/tags`, { name: "x" });
    await call("POST", `/api/objects/${b.id}/tags`, { name: "x" });
    sqlite.prepare("UPDATE object_tags SET origin = 'ai', ai_role = 'archivist', ai_model = 'm', ai_date = '2026-01-01' WHERE object_id = ?").run(a.id);
    const tag = (await call("GET", "/api/tags")).json[0];
    const gone = (await call("DELETE", `/api/tags/${tag.id}`)).json;
    const rejected = sqlite.prepare("SELECT object_id FROM ai_rejected WHERE kind = 'tag' AND value = 'x'").all();
    expect(rejected).toEqual([{ object_id: a.id }]);
    await call("POST", "/api/tags/restore", gone);
    expect(count("SELECT count(*) AS n FROM ai_rejected")).toBe(0);
    expect(count("SELECT count(*) AS n FROM object_tags WHERE origin = 'ai'")).toBe(1);
  });
});
