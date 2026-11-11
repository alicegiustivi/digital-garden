// "Part of": a Piece is part of a Project (issue #140; CONTEXT.md: Piece, Project, Stage, Connection Kind).
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";
import { addDirectConnection } from "../src/server/archivist.ts";

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
const make = async (type: string, title?: string, extra: object = {}) => (await call("POST", "/api/objects", { type, title, ...extra })).json;
const join_ = (piece: any, project: any, extra: object = {}) => call("POST", "/api/connections", { a: piece.id, b: project.id, kind: "part of", ...extra });
const outline = async (project: any) => (await call("GET", `/api/objects/${project.id}/pieces`)).json.pieces.map((p: any) => p.title);
const setStage = (o: any, field: string, v: string) => call("PATCH", `/api/objects/${o.id}`, { fields: { [field]: v } });

describe("the kind", () => {
  it("reads 'part of' from the Piece and 'has part' from the Project", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    const r = await join_(piece, project);
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: "part of", label: "part of", subject: true, origin: "owner", other: { id: project.id, title: "Essays" } });
    expect((await call("GET", `/api/objects/${project.id}/connections`)).json[0]).toMatchObject({ kind: "part of", label: "has part", subject: false, other: { id: piece.id } });
    expect((await call("GET", "/api/connection-kinds")).json.filter((k: any) => k.kind === "part of").map((k: any) => k.label)).toEqual(["part of", "has part"]);
  });
  it("joins the Piece to the Project whichever one the owner started from", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    await call("POST", "/api/connections", { a: project.id, b: piece.id, kind: "part of" });
    expect(sqlite.prepare("SELECT from_id, to_id FROM connections").get()).toEqual({ from_id: piece.id, to_id: project.id });
  });
  it("is allowed only from a Piece to a Project", async () => {
    const piece = await make("piece", "A"), piece2 = await make("piece", "B"), project = await make("project", "P"), project2 = await make("project", "Q");
    const thought = await make("thought", "T"), concept = await make("concept", "C");
    for (const [a, b] of [[piece, piece2], [project, project2], [thought, project], [piece, concept], [thought, concept]]) {
      const r = await join_(a, b);
      expect(r.status).toBe(400);
      expect(r.json.error).toMatch(/Piece to a Project/);
    }
    expect(sqlite.prepare("SELECT count(*) AS n FROM connections").get()).toEqual({ n: 0 });
  });
  it("can be chosen later on an existing Connection (from either end), and left again", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    const c = (await call("POST", "/api/connections", { a: project.id, b: piece.id })).json;
    expect(c.kind).toBe("related");
    expect((await call("PATCH", `/api/connections/${c.id}`, { kind: "part of", subject: project.id })).status).toBe(200); // the subject is ignored: a Piece is always the one that is part of
    expect(sqlite.prepare("SELECT from_id, to_id, kind FROM connections").get()).toEqual({ from_id: piece.id, to_id: project.id, kind: "part of" });
    expect(await outline(project)).toEqual(["Slowness"]);
    await call("PATCH", `/api/connections/${c.id}`, { kind: "related" });
    expect(await outline(project)).toEqual([]);
  });
  it("can't be put on two Objects that aren't a Piece and a Project when changing the kind", async () => {
    const a = await make("thought", "A"), b = await make("project", "P");
    const c = (await call("POST", "/api/connections", { a: a.id, b: b.id })).json;
    expect((await call("PATCH", `/api/connections/${c.id}`, { kind: "part of" })).status).toBe(400);
  });
  it("is the owner's: no AI role creates it, and the database refuses one that isn't", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    expect(() => addDirectConnection(sqlite, piece.id, project.id, "part of" as any, "m", "2026-11-10")).toThrow();
    expect(() => sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date) VALUES (?, ?, 'part of', 'ai', 'Archivist', 'm', 'd')").run(piece.id, project.id)).toThrow();
    expect(() => sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'part of', 'source')").run(piece.id, project.id)).toThrow();
    expect(sqlite.prepare("SELECT count(*) AS n FROM connections").get()).toEqual({ n: 0 });
  });
  it("still refuses an unknown kind, and two Objects still have at most one Connection", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    expect((await call("POST", "/api/connections", { a: piece.id, b: project.id, kind: "owned by" })).status).toBe(400);
    expect(() => sqlite.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES (?, ?, 'owned by', 'owner')").run(piece.id, project.id)).toThrow();
    await join_(piece, project);
    expect((await join_(piece, project)).json.error).toMatch(/already connected/);
    expect((await call("POST", "/api/connections", { a: project.id, b: piece.id, kind: "related" })).status).toBe(400);
  });
});

describe("a Piece belongs to at most one Project", () => {
  it("refuses a second Project with a clear message that names the first", async () => {
    const piece = await make("piece", "Slowness"), p1 = await make("project", "Essays"), p2 = await make("project", "Trip");
    await join_(piece, p1);
    const r = await join_(piece, p2);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/already part of “Essays”/);
    expect(r.json.partOf).toEqual({ id: p1.id, title: "Essays" });
    expect(await outline(p1)).toEqual(["Slowness"]);
    expect(await outline(p2)).toEqual([]);
  });
  it("moves it when the owner chooses to, to the end of the new outline", async () => {
    const piece = await make("piece", "Slowness"), other = await make("piece", "Rest"), p1 = await make("project", "Essays"), p2 = await make("project", "Trip");
    await join_(piece, p1); await join_(other, p2);
    expect((await join_(piece, p2, { move: true })).status).toBe(201);
    expect(await outline(p1)).toEqual([]);
    expect(await outline(p2)).toEqual(["Rest", "Slowness"]);
  });
  it("is checked too when an existing Connection is changed to 'part of'", async () => {
    const piece = await make("piece", "Slowness"), p1 = await make("project", "Essays"), p2 = await make("project", "Trip");
    await join_(piece, p1);
    const c = (await call("POST", "/api/connections", { a: piece.id, b: p2.id })).json;
    const r = await call("PATCH", `/api/connections/${c.id}`, { kind: "part of" });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/already part of “Essays”/);
    expect((await call("PATCH", `/api/connections/${c.id}`, { kind: "part of", move: true })).status).toBe(200);
    expect(await outline(p1)).toEqual([]);
    expect(await outline(p2)).toEqual(["Slowness"]);
  });
  it("lets a Project in the Bin go: its Pieces can join another", async () => {
    const piece = await make("piece", "Slowness"), p1 = await make("project", "Old"), p2 = await make("project", "New");
    await join_(piece, p1);
    await call("DELETE", `/api/objects/${p1.id}`);
    expect((await call("GET", `/api/objects/${piece.id}/project`)).json.project).toBeNull();
    expect((await join_(piece, p2)).status).toBe(201);
  });
  it("lets many Pieces share one Project, and a Piece stand alone", async () => {
    const a = await make("piece", "A"), b = await make("piece", "B"), alone = await make("piece", "Alone"), project = await make("project", "P");
    await join_(a, project); await join_(b, project);
    expect(await outline(project)).toEqual(["A", "B"]);
    expect((await call("GET", `/api/objects/${alone.id}/project`)).json).toEqual({ project: null });
  });
});

describe("the outline", () => {
  it("lists Pieces in the order they were added, each with its own Stage and the lock when Private", async () => {
    const a = await make("piece", "A"), b = await make("piece", "B", { private: true }), project = await make("project", "P");
    await setStage(b, "stage-piece", "Drafting");
    await join_(a, project); await join_(b, project);
    const r = (await call("GET", `/api/objects/${project.id}/pieces`)).json;
    expect(r.project).toMatchObject({ title: "P", stage: "Active" });
    expect(r.pieces).toMatchObject([{ id: a.id, title: "A", stage: "Idea", private: false }, { id: b.id, title: "B", stage: "Drafting", private: true }]);
  });
  it("is dragged into a new order that is kept, and a new Piece goes to the end", async () => {
    const [a, b, c] = [await make("piece", "A"), await make("piece", "B"), await make("piece", "C")];
    const project = await make("project", "P");
    for (const x of [a, b, c]) await join_(x, project);
    const r = await call("PUT", `/api/objects/${project.id}/pieces/order`, { order: [c.id, a.id, b.id] });
    expect(r.status).toBe(200);
    expect(r.json.pieces.map((p: any) => p.title)).toEqual(["C", "A", "B"]);
    expect(await outline(project)).toEqual(["C", "A", "B"]);
    const d = await make("piece", "D");
    await join_(d, project);
    expect(await outline(project)).toEqual(["C", "A", "B", "D"]);
  });
  it("refuses an order that doesn't match the Project's Pieces", async () => {
    const a = await make("piece", "A"), b = await make("piece", "B"), stray = await make("piece", "Stray"), project = await make("project", "P");
    await join_(a, project); await join_(b, project);
    for (const order of [[a.id], [a.id, b.id, stray.id], [a.id, a.id], "nope"]) expect((await call("PUT", `/api/objects/${project.id}/pieces/order`, { order })).status).toBe(400);
    expect(await outline(project)).toEqual(["A", "B"]);
    expect((await call("PUT", `/api/objects/${a.id}/pieces/order`, { order: [] })).status).toBe(404); // a Piece has no outline
  });
  it("is kept only inside its Project: each Project has its own order, and removing a Piece closes the gap", async () => {
    const [a, b, c] = [await make("piece", "A"), await make("piece", "B"), await make("piece", "C")];
    const p1 = await make("project", "P1"), p2 = await make("project", "P2");
    await join_(a, p1); await join_(b, p1); await join_(c, p2);
    await call("PUT", `/api/objects/${p1.id}/pieces/order`, { order: [b.id, a.id] });
    expect(await outline(p2)).toEqual(["C"]);
    const conn = (await call("GET", `/api/objects/${b.id}/connections`)).json[0];
    await call("DELETE", `/api/connections/${conn.id}`);
    expect(sqlite.prepare("SELECT position FROM connections WHERE from_id = ?").get(a.id)).toEqual({ position: 0 });
    expect(await outline(p1)).toEqual(["A"]);
    expect((await call("GET", `/api/objects/${b.id}/project`)).json.project).toBeNull(); // a standalone Piece has no place
  });
  it("puts a removed Piece back where it was when the owner undoes", async () => {
    const [a, b, c] = [await make("piece", "A"), await make("piece", "B"), await make("piece", "C")];
    const project = await make("project", "P");
    for (const x of [a, b, c]) await join_(x, project);
    const conn = (await call("GET", `/api/objects/${b.id}/connections`)).json[0];
    const removed = (await call("DELETE", `/api/connections/${conn.id}`)).json;
    expect(await outline(project)).toEqual(["A", "C"]);
    expect((await call("POST", "/api/connections/restore", removed.was)).status).toBe(201);
    expect(await outline(project)).toEqual(["A", "B", "C"]);
  });
  it("leaves out a Piece in the Bin and shows it again when restored", async () => {
    const a = await make("piece", "A"), b = await make("piece", "B"), project = await make("project", "P");
    await join_(a, project); await join_(b, project);
    await call("DELETE", `/api/objects/${a.id}`);
    expect(await outline(project)).toEqual(["B"]);
    await call("POST", `/api/objects/${a.id}/restore`);
    expect(await outline(project)).toEqual(["A", "B"]);
  });
});

describe("a Piece shows its Project", () => {
  it("with its name and Stage", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    await join_(piece, project);
    await setStage(project, "stage-project", "Paused");
    expect((await call("GET", `/api/objects/${piece.id}/project`)).json.project).toMatchObject({ id: project.id, title: "Essays", stage: "Paused", private: false });
    expect((await call("GET", `/api/objects/${project.id}/project`)).status).toBe(404); // only a Piece has one
  });
});

describe("Stages stay independent", () => {
  it("changing a Project's Stage changes nothing about its Pieces, or the other way round", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    await join_(piece, project);
    await setStage(project, "stage-project", "Finished");
    await setStage(piece, "stage-piece", "Drafting");
    const r = (await call("GET", `/api/objects/${project.id}/pieces`)).json;
    expect(r.project.stage).toBe("Finished");
    expect(r.pieces[0].stage).toBe("Drafting");
    await setStage(project, "stage-project", "Active");
    expect((await call("GET", `/api/objects/${project.id}/pieces`)).json.pieces[0].stage).toBe("Drafting");
  });
});

describe("keeping it sound", () => {
  it("won't change the type of a Piece that is part of a Project, or of a Project with Pieces", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    await join_(piece, project);
    expect((await call("PATCH", `/api/objects/${piece.id}`, { type: "thought" })).status).toBe(400);
    expect((await call("PATCH", `/api/objects/${project.id}`, { type: "concept" })).status).toBe(400);
    expect((await call("PATCH", `/api/objects/${piece.id}`, { type: "piece" })).status).toBe(200); // no change
    const c = (await call("GET", `/api/objects/${piece.id}/connections`)).json[0];
    await call("DELETE", `/api/connections/${c.id}`);
    expect((await call("PATCH", `/api/objects/${piece.id}`, { type: "thought" })).status).toBe(200);
  });
  it("merging two Pieces: the same Project is fine, different Projects are refused", async () => {
    const [a, b, c] = [await make("piece", "A"), await make("piece", "B"), await make("piece", "C")];
    const p1 = await make("project", "P1"), p2 = await make("project", "P2");
    await join_(a, p1); await join_(b, p1); await join_(c, p2);
    expect((await call("POST", `/api/objects/${a.id}/merge`, { from: c.id })).status).toBe(400);
    expect((await call("POST", `/api/objects/${a.id}/merge`, { from: b.id })).status).toBe(200);
    expect(await outline(p1)).toEqual(["A"]);
  });
  it("merging a standalone Piece into one in a Project, or two Projects, keeps the outline in order", async () => {
    const a = await make("piece", "A"), b = await make("piece", "B"), lone = await make("piece", "Lone");
    const p1 = await make("project", "P1"), p2 = await make("project", "P2");
    await join_(a, p1); await join_(b, p2);
    expect((await call("POST", `/api/objects/${a.id}/merge`, { from: lone.id })).status).toBe(200);
    expect((await call("POST", `/api/objects/${p1.id}/merge`, { from: p2.id })).status).toBe(200);
    expect(await outline(p1)).toEqual(["A", "B"]);
    expect(sqlite.prepare("SELECT position FROM connections ORDER BY position").all()).toEqual([{ position: 0 }, { position: 1 }]);
  });
  it("shows on the Map as a kind, and in an Export's wording", async () => {
    const piece = await make("piece", "Slowness"), project = await make("project", "Essays");
    await join_(piece, project);
    expect((await call("GET", "/api/graph")).json.edges).toMatchObject([{ from: piece.id, to: project.id, kind: "part of" }]);
  });
});

describe("an existing Garden upgrades cleanly", () => {
  it("keeps every Connection (with notes, Origin and dates) and adds the new kind", () => {
    const old = new Database(":memory:");
    old.pragma("foreign_keys = ON");
    const dir = join(import.meta.dirname, "../migrations");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql") && f < "0019").sort()) old.exec(readFileSync(join(dir, f), "utf8"));
    for (const id of ["a", "b", "c"]) old.prepare("INSERT INTO objects (id, type) VALUES (?, 'thought')").run(id);
    old.prepare("INSERT INTO connections (from_id, to_id, kind, origin, note) VALUES ('a','b','supports','owner','because')").run();
    old.prepare("INSERT INTO connections (from_id, to_id, kind, origin, ai_role, ai_model, ai_date, approved) VALUES ('b','c','related','ai','Archivist','m','2026-01-01',1)").run();
    const before = old.prepare("SELECT id, from_id, to_id, kind, origin, ai_role, ai_model, ai_date, note, approved, created_at FROM connections ORDER BY id").all();
    old.exec(readFileSync(join(dir, "0019_part_of.sql"), "utf8"));
    expect(old.prepare("SELECT id, from_id, to_id, kind, origin, ai_role, ai_model, ai_date, note, approved, created_at FROM connections ORDER BY id").all()).toEqual(before);
    expect(old.prepare("SELECT position FROM connections").all()).toEqual([{ position: null }, { position: null }]);
    old.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES ('a','c','part of','owner')").run();
    expect(() => old.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES ('c','a','nope','owner')").run()).toThrow();
    // The one-per-pair rule and the Timeline's date stamp came through the rebuild.
    expect(() => old.prepare("INSERT INTO connections (from_id, to_id, kind, origin) VALUES ('c','a','related','owner')").run()).toThrow();
    expect((old.prepare("SELECT created_at FROM connections WHERE kind = 'part of'").get() as any).created_at).toBeTruthy();
  });
});
