// Piece and Project as Core Object Types (issue #139; CONTEXT.md: Piece, Project, Stage; ADR 0008).
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-express-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate } = await import("../src/server/ai-gate.ts");
const { createAi } = await import("../src/server/ai-queue.ts");
const { archivistPrompt, candidatesFor } = await import("../src/server/ai-prompt.ts");
const { applyProposals, applyConnections } = await import("../src/server/suggestions.ts");

let sent: any[], sqlite: ReturnType<typeof openDb>["sqlite"], app: ReturnType<typeof createApp>, ai: ReturnType<typeof createAi>;
const fakeFetch = (async (_u: string, init: any) => {
  sent.push(JSON.parse(init.body));
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"tags":["x"]}' } }] }), { status: 200 });
}) as unknown as typeof fetch;
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  sent = [];
  ai = createAi(sqlite, { gate: createGate({ fetch: fakeFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), now: () => new Date("2026-11-10T10:00:00Z"), hasKey: () => true });
  app = createApp(sqlite, { readLink: () => {}, ai });
});
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title?: string, extra: object = {}) => (await call("POST", "/api/objects", { type, title, ...extra })).json;
const stageOf = (o: any, key: string) => o.fields.find((f: any) => f.key === key)?.value;

describe("Piece and Project exist", () => {
  it("come after People, in the order Projects then Pieces, as Core types with their colour and icon", async () => {
    const t = (await call("GET", "/api/types")).json.types;
    expect(t.map((x: any) => x.key)).toEqual(["source", "concept", "thought", "person", "project", "piece"]);
    expect(t.find((x: any) => x.key === "project")).toMatchObject({ label: "Project", plural: "Projects", color: "green", icon: "book", core: true });
    expect(t.find((x: any) => x.key === "piece")).toMatchObject({ label: "Piece", plural: "Pieces", color: "orange", icon: "pen", core: true });
  });
  it("have only a Stage and an About line, and no property can be added or removed", async () => {
    const t = (await call("GET", "/api/types")).json.types;
    expect(t.find((x: any) => x.key === "piece").fields).toMatchObject([{ label: "Stage", input: "select", options: ["Idea", "Drafting", "Finished"] }, { label: "About", input: "text", lead: true }]);
    expect(t.find((x: any) => x.key === "project").fields).toMatchObject([{ label: "Stage", options: ["Active", "Paused", "Finished"] }, { label: "About", lead: true }]);
    expect((await call("POST", "/api/types/piece/fields", { label: "Word count", input: "text" })).status).toBe(400);
    expect((await call("DELETE", "/api/types/piece")).status).toBe(400);
    expect((await call("PATCH", "/api/types/project", { label: "Plan" })).status).toBe(400);
  });
  it("can be recoloured and reordered like any Core type", async () => {
    expect((await call("PATCH", "/api/types/piece", { color: "rose" })).status).toBe(200);
    expect((await call("GET", "/api/types")).json.types.find((x: any) => x.key === "piece").color).toBe("rose");
  });
  it("sit before a type the owner made, which an upgrade pushes down", () => {
    // An older Garden: everything up to 0016, with a type of the owner's own sitting right after People.
    const old = new Database(":memory:");
    const dir = join(import.meta.dirname, "../migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0017").sort()) old.exec(readFileSync(join(dir, f), "utf8"));
    old.prepare("INSERT INTO object_types (key, label, plural, position, color, icon, core) VALUES ('x-book','Book','Books',5,'teal','book',0)").run();
    old.prepare("INSERT INTO objects (id, type) VALUES ('b1','x-book')").run();
    old.exec(readFileSync(join(dir, "0017_piece_project.sql"), "utf8"));
    expect(old.prepare("SELECT key FROM object_types ORDER BY position").all().map((r: any) => r.key)).toEqual(["source", "concept", "thought", "person", "project", "piece", "x-book"]);
    expect(old.prepare("SELECT type FROM objects WHERE id = 'b1'").get()).toEqual({ type: "x-book" }); // nothing the owner had is touched
  });
});

describe("making, editing, finding and binning them", () => {
  it("a new Piece starts at Idea and a new Project at Active, in the owner's name", async () => {
    const p = await make("piece", "On slowness"), j = await make("project", "Essay series");
    expect(p.fields.find((f: any) => f.key === "stage-piece")).toMatchObject({ value: "Idea", origin: "owner" });
    expect(j.fields.find((f: any) => f.key === "stage-project")).toMatchObject({ value: "Active", origin: "owner" });
  });
  it("the owner sets the Stage and the About line; a Stage must be one of its own", async () => {
    const p = await make("piece", "On slowness");
    const r = await call("PATCH", `/api/objects/${p.id}`, { fields: { "stage-piece": "Drafting", about: "Why I stopped hurrying" } });
    expect(stageOf(r.json, "stage-piece")).toBe("Drafting");
    expect(stageOf(r.json, "about")).toBe("Why I stopped hurrying");
    expect((await call("PATCH", `/api/objects/${p.id}`, { fields: { "stage-piece": "Active" } })).status).toBe(400); // a Project's Stage
    expect(stageOf((await call("GET", `/api/objects/${p.id}`)).json, "stage-piece")).toBe("Drafting");
  });
  it("carries a body, Tags and Private, is found by title and body (Private too), and goes to the Bin and back", async () => {
    const p = await make("piece", "On slowness", { private: true });
    await call("PUT", `/api/objects/${p.id}/body`, { paragraphs: ["Hurry is a habit, not a need."] });
    await call("POST", `/api/objects/${p.id}/tags`, { name: "essay" });
    const found = (q: string) => call("GET", `/api/find?q=${q}`).then((r) => r.json.hits.map((h: any) => h.id));
    expect(await found("slowness")).toEqual([p.id]);
    expect(await found("habit")).toEqual([p.id]);
    expect((await call("GET", `/api/objects/${p.id}`)).json.private).toBe(true);
    expect((await call("DELETE", `/api/objects/${p.id}`)).status).toBe(200);
    expect(await found("slowness")).toEqual([]);
    expect((await call("POST", `/api/objects/${p.id}/restore`)).status).toBe(200);
    expect(await found("slowness")).toEqual([p.id]);
  });
  it("Search filters by Stage, and only within the Piece or Project type", async () => {
    const a = await make("piece", "Alpha essay"), b = await make("piece", "Beta essay"), j = await make("project", "Gamma essay");
    await call("PATCH", `/api/objects/${b.id}`, { fields: { "stage-piece": "Finished" } });
    const ids = async (qs: string) => (await call("GET", "/api/find?" + qs)).json.hits.map((h: any) => h.id).sort();
    expect(await ids("q=essay&type=piece&stage=Idea")).toEqual([a.id]);
    expect(await ids("q=essay&type=piece&stage=Finished")).toEqual([b.id]);
    expect(await ids("q=essay&type=project&stage=Active")).toEqual([j.id]);
    expect(await ids("type=piece&stage=Finished")).toEqual([b.id]);
    expect(await ids("q=essay&type=project&stage=Finished")).toEqual([]);
  });
});

describe("the Archivist never touches them", () => {
  it("never queues, runs or reads a Piece or Project, even when asked", async () => {
    const p = await make("piece", "On slowness"), j = await make("project", "Essay series");
    ai.enqueueCaptured([p.id, j.id]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_jobs").get()).toEqual({ n: 0 });
    expect(ai.request(p.id)).toBe(false);
    expect((await call("POST", `/api/objects/${j.id}/ai/run`)).status).toBe(400);
    expect(archivistPrompt(sqlite, p.id)).toBeNull();
    expect(ai.statusOf(p.id)).toMatchObject({ canRun: false });
    expect(sent).toEqual([]);
  });
  it("a job already waiting for one is skipped, and nothing is written", async () => {
    const p = await make("piece", "On slowness");
    ai.enqueue("archivist", p.id, 1, new Date("2026-11-10T09:00:00Z"));
    await ai.tick();
    expect(sent).toEqual([]);
    expect(sqlite.prepare("SELECT count(*) AS n FROM object_tags").get()).toEqual({ n: 0 });
  });
  it("never offers one as a Connection candidate, and proposes nothing about one", async () => {
    const s = await make("source", "Walden"), p = await make("piece", "Walden notes essay"), j = await make("project", "Walden project");
    await call("POST", `/api/objects/${s.id}/tags`, { name: "walden" });
    const cands = candidatesFor(sqlite, s.id).map((c) => c.id);
    expect(cands).not.toContain(p.id);
    expect(cands).not.toContain(j.id);
    expect(candidatesFor(sqlite, p.id)).toEqual([]);
    expect(applyProposals(sqlite, p.id, { claims: [], related: [], people: [] }, [], "m", new Date())).toBe(0);
    expect(applyConnections(sqlite, j.id, { related: [], specific: [] }, [], "m", new Date(), null)).toBe(0);
  });
  it("a Piece's words are never marked as AI", async () => {
    const p = await make("piece", "On slowness");
    await call("PUT", `/api/objects/${p.id}/body`, { paragraphs: ["Mine."] });
    const o = (await call("GET", `/api/objects/${p.id}`)).json;
    expect([...o.blocks, ...o.fields].every((x: any) => x.origin === "owner")).toBe(true);
  });
});
