import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";
import { deskOf, fromYourGarden, saveVersion } from "../src/server/desk.ts";

let app: ReturnType<typeof createApp>;
let sqlite: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => { sqlite = openDb(":memory:").sqlite; app = createApp(sqlite); });
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title?: string, priv = false) => (await call("POST", "/api/objects", { type, title, private: priv })).json;
const link = async (a: any, b: any, kind = "related") => {
  const c = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
  if (kind !== "related") await call("PATCH", `/api/connections/${c.id}`, { kind });
  return c;
};
const desk = async (c: any) => (await call("GET", `/api/concepts/${c.id}/desk`)).json;
const old = (id: string, days: number) => sqlite.prepare("UPDATE objects SET created_at = datetime('now', ?), updated_at = datetime('now', ?) WHERE id = ?").run(`-${days} days`, `-${days} days`, id);

describe("Your view over time", () => {
  it("keeps at most one version a day, shows earlier days only, and never deletes one by one", async () => {
    const c = await make("concept", "Attention");
    await call("PUT", `/api/objects/${c.id}/body`, { paragraphs: ["First view"] });
    await call("PUT", `/api/objects/${c.id}/body`, { paragraphs: ["Second view"] });
    expect(sqlite.prepare("SELECT count(*) AS n FROM concept_versions WHERE object_id = ?").get(c.id)).toEqual({ n: 1 });
    expect((await desk(c)).versions).toEqual([]); // today's is the live view
    saveVersion(sqlite, c.id, new Date(Date.now() + 2 * 864e5)); // two days later the same text is saved again
    const d = deskOf(sqlite, c.id, new Date(Date.now() + 2 * 864e5))!;
    expect(d.versions).toHaveLength(1);
    expect(d.versions[0].paragraphs).toEqual(["Second view"]);
    expect((await app.request(`/api/concept-versions/${c.id}`, { method: "DELETE" })).status).not.toBe(200); // no way to delete one
  });
  it("keeps versions only for Concepts and shows a Mention by name", async () => {
    const t = await make("thought", "Plain");
    await call("PUT", `/api/objects/${t.id}/body`, { paragraphs: ["hello"] });
    expect(sqlite.prepare("SELECT count(*) AS n FROM concept_versions").get()).toEqual({ n: 0 });
    const c = await make("concept", "C"); const s = await make("source", "A book");
    await call("PUT", `/api/objects/${c.id}/body`, { paragraphs: [`See [[o:${s.id}]] here`] });
    sqlite.prepare("UPDATE concept_versions SET day = '2020-01-01' WHERE object_id = ?").run(c.id);
    expect((await desk(c)).versions[0].paragraphs[0]).toBe("See “A book” here");
  });
});

describe("The desk", () => {
  it("groups Connections by kind, counts only owner-made or approved ones, and shows pending Suggestions as a number", async () => {
    const c = await make("concept", "C");
    const a = await make("source", "A"); const b = await make("thought", "B"); const p = await make("person", "P");
    await link(c, a, "supports"); await link(c, b, "contradicts"); await link(c, p);
    sqlite.prepare("INSERT INTO ai_suggestions (object_id, kind, data, ai_role, ai_model, ai_date, created_at) VALUES (?, 'connection', ?, 'archivist', 'm', '2026-01-01', '2026-01-01')").run(c.id, JSON.stringify({ otherId: a.id, kind: "related" }));
    const d = await desk(c);
    expect(d.total).toBe(3);
    expect(d.groups.map((g: any) => [g.label, g.items.length])).toEqual([["Supports", 1], ["Contradicts", 1], ["Builds on", 0], ["Related", 1]]);
    expect(d.suggested).toBe(1);
    expect(d.mix).toEqual({ source: 1, thought: 1, person: 1 });
    sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date, approved) VALUES (?, ?, 'related', 'ai', 'archivist', 'm', '2026-01-01', 0)").run(c.id, (await make("source", "Loose")).id);
    expect((await desk(c)).total).toBe(3); // an unapproved AI Connection does not count
  });
  it("lists Tensions as contradicting pairs inside the Concept only, and Private Objects count for the owner", async () => {
    const c = await make("concept", "C");
    const a = await make("thought", "A"); const b = await make("source", "B", true); const out = await make("thought", "Outside");
    await link(c, a); await link(c, b); await link(a, b, "contradicts"); await link(a, out, "contradicts");
    const d = await desk(c);
    expect(d.tensions).toHaveLength(1);
    expect(d.tensions[0].b.private || d.tensions[0].a.private).toBe(true);
    expect(d.privateCount).toBe(1);
  });
  it("is only for Concepts", async () => {
    const t = await make("thought", "T");
    expect((await call("GET", `/api/concepts/${t.id}/desk`)).status).toBe(404);
  });
  it("opens an empty Thought connected to both Objects, owned by the owner", async () => {
    const a = await make("source", "A"); const b = await make("thought", "B", true);
    const r = await call("POST", "/api/thoughts/about", { a: a.id, b: b.id });
    expect(r.status).toBe(201);
    const t = (await call("GET", `/api/objects/${r.json.id}`)).json;
    expect(t.type).toBe("thought"); expect(t.blocks).toEqual([]); expect(t.private).toBe(false);
    const cs = (await call("GET", `/api/objects/${t.id}/connections`)).json;
    expect(cs.map((x: any) => x.other.id).sort()).toEqual([a.id, b.id].sort());
    expect(cs.every((x: any) => x.origin === "owner" && x.kind === "related")).toBe(true);
    expect((await call("POST", "/api/thoughts/about", { a: a.id, b: a.id })).status).toBe(400);
  });
});

describe("Open Questions", () => {
  it("are marked only by the owner, on Thoughts, settled with a date and reopened, with no due dates", async () => {
    const t = await make("thought", "Why?"); const s = await make("source", "S");
    expect((await call("PUT", `/api/objects/${s.id}/question`, { state: "open" })).status).toBe(400);
    const open = (await call("PUT", `/api/objects/${t.id}/question`, { state: "open" })).json;
    expect(open.state).toBe("open"); expect(open).not.toHaveProperty("due");
    expect((await call("PUT", `/api/objects/${t.id}/question`, { state: "settled" })).json.settledAt).toBeTruthy();
    expect((await call("PUT", `/api/objects/${t.id}/question`, { state: "open" })).json.settledAt).toBeNull();
    expect((await call("PUT", `/api/objects/${t.id}/question`, { state: "none" })).json).toBeNull();
  });
  it("can point to a connected Thought that settled it, and are listed on the Concept and under Questions", async () => {
    const c = await make("concept", "C"); const q = await make("thought", "Q"); const a = await make("thought", "The answer");
    await link(c, q); await link(q, a);
    await call("PUT", `/api/objects/${q.id}/question`, { state: "open" });
    expect((await call("PUT", `/api/objects/${q.id}/question`, { state: "settled", settledBy: c.id })).status).toBe(400);
    const done = (await call("PUT", `/api/objects/${q.id}/question`, { state: "settled", settledBy: a.id })).json;
    expect(done.settledBy.title).toBe("The answer");
    expect((await desk(c)).questions.map((x: any) => x.state)).toEqual(["settled"]);
    const all = (await call("GET", "/api/questions")).json;
    expect(all.settled[0].concepts.map((x: any) => x.title)).toEqual(["C"]);
    await call("DELETE", `/api/objects/${q.id}`);
    expect((await call("GET", "/api/questions")).json.settled).toEqual([]);
  });
});

describe("From your Garden", () => {
  it("shows older Objects with a reason, never Unreviewed or dismissed ones, at most one stale question, and no count", async () => {
    const q1 = await make("thought", "Q1"); const q2 = await make("thought", "Q2");
    for (const q of [q1, q2]) { await call("PUT", `/api/objects/${q.id}/question`, { state: "open" }); old(q.id, 100); }
    const a = await make("source", "Old A", true); const b = await make("source", "Old B");
    const un = { id: "00000000-0000-4000-8000-000000000001" };
    sqlite.prepare("INSERT INTO objects (id, type, unreviewed, created_at, updated_at) VALUES (?, 'source', 1, datetime('now', '-200 days'), datetime('now', '-200 days'))").run(un.id);
    old(a.id, 90); old(b.id, 120);
    const r = fromYourGarden(sqlite);
    expect(r.items.length).toBeGreaterThanOrEqual(2); expect(r.items.length).toBeLessThanOrEqual(3);
    expect(r.items.map((i) => i.id)).not.toContain(un.id);
    expect(r.items.filter((i) => i.reason.startsWith("An open question"))).toHaveLength(1);
    expect(r.items.every((i) => i.reason)).toBe(true);
    expect(r).not.toHaveProperty("count");
    const gone = r.items[0].id;
    await call("POST", "/api/garden/dismiss", { id: gone });
    expect(fromYourGarden(sqlite).items.map((i) => i.id)).not.toContain(gone);
    expect((await call("GET", "/api/garden")).json.items.map((i: any) => i.id)).not.toContain(gone);
  });
  it("is empty in a young Garden and explains new Connections", async () => {
    expect((await call("GET", "/api/garden")).json.items).toEqual([]);
    const o = await make("source", "Old"); const n = await make("thought", "New"); old(o.id, 40);
    await link(o, n);
    expect(fromYourGarden(sqlite).items[0].reason).toBe("Just got a new Connection, from New");
  });
});
