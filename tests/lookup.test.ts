// Issue #108 (ADR 0009): looking facts up on the web. A pretend Wikipedia, Wikidata and Open Library answer; every request made is kept,
// so the tests can prove exactly what left the Mac.
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.GARDEN_DIR = mkdtempSync(join(tmpdir(), "garden-lookup-test-"));
const { openDb } = await import("../src/server/db.ts");
const { createApp } = await import("../src/server/app.ts");
const { createGate } = await import("../src/server/ai-gate.ts");
const { createAi } = await import("../src/server/ai-queue.ts");
const { createWebGate, SITES } = await import("../src/server/web-gate.ts");
const ex = await import("../src/server/export.ts");

// ---- a pretend web ----
let urls: string[], mode: "ok" | "offline" | "slow" | "limit" | "down";
const wd = (id: string, label: string, description: string) => ({ id, label, description });
const WIKIDATA: Record<string, any[]> = {
  "ursula k. le guin": [wd("Q181659", "Ursula K. Le Guin", "American author (1929–2018)")],
  "john smith": [wd("Q1", "John Smith", "English explorer"), wd("Q2", "John Smith", "American actor"), wd("Q3", "John Smith", "British politician")],
  "antifragility": [wd("Q9", "Antifragility", "property of systems that gain from disorder")],
  "le guin": [wd("Q181659", "Ursula K. Le Guin", "American author")], // not an exact match: never taken without the owner
  "tide pools": [wd("Q77", "Tide pools", "rock pools on a shore")],
  "nothingatall": [],
};
const ENTITIES: Record<string, any> = {
  Q181659: { claims: { P569: [{ mainsnak: { datavalue: { value: { time: "+1929-10-21T00:00:00Z" } } } }], P570: [{ mainsnak: { datavalue: { value: { time: "+2018-01-22T00:00:00Z" } } } }] }, sitelinks: { enwiki: { title: "Ursula K. Le Guin" } } },
  Q9: { claims: {}, sitelinks: { enwiki: { title: "Antifragility" } } },
  Q77: { claims: { P571: [{ mainsnak: { datavalue: { value: { time: "+1850-00-00T00:00:00Z" } } } }] }, sitelinks: {} },
};
const SUMMARIES: Record<string, string> = {
  "Ursula_K._Le_Guin": "Ursula Kroeber Le Guin was an American author. She is best known for her works of speculative fiction. Later sentences follow.",
  Antifragility: "Antifragility is a property of systems in which they increase in capability to thrive as a result of stressors, shocks or volatility.",
};
const BOOKS: Record<string, any[]> = {
  "the dispossessed": [{ key: "/works/OL1W", title: "The Dispossessed", author_name: ["Ursula K. Le Guin"], first_publish_year: 1974 }],
  dune: [{ key: "/works/OL2W", title: "Dune", author_name: ["Frank Herbert"], first_publish_year: 1965 }, { key: "/works/OL3W", title: "Dune", author_name: ["Brian Herbert"], first_publish_year: 2010 }],
};
const fakeFetch = (async (url: string) => {
  urls.push(String(url));
  if (mode === "offline") throw new TypeError("fetch failed");
  if (mode === "slow") { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }
  if (mode === "limit") return new Response("{}", { status: 429 });
  if (mode === "down") return new Response("{}", { status: 503 });
  const u = new URL(String(url));
  const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status });
  if (u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbsearchentities") return json({ search: WIKIDATA[(u.searchParams.get("search") ?? "").toLowerCase()] ?? [] });
  if (u.hostname === "www.wikidata.org" && u.searchParams.get("action") === "wbgetentities") return json({ entities: { [u.searchParams.get("ids")!]: ENTITIES[u.searchParams.get("ids")!] ?? {} } });
  if (u.hostname === "en.wikipedia.org") { const t = decodeURIComponent(u.pathname.split("/").pop()!); return SUMMARIES[t] ? json({ type: "standard", extract: SUMMARIES[t] }) : json({}, 404); }
  if (u.hostname === "openlibrary.org") return json({ docs: BOOKS[(u.searchParams.get("title") ?? "").toLowerCase()] ?? [] });
  return json({}, 404);
}) as unknown as typeof fetch;

let sqlite: ReturnType<typeof openDb>["sqlite"], app: ReturnType<typeof createApp>;
beforeEach(() => {
  sqlite = openDb(":memory:").sqlite;
  urls = []; mode = "ok";
  app = createApp(sqlite, { readLink: () => {}, web: createWebGate({ fetch: fakeFetch }) });
});
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
};
const make = async (type: string, title: string, extra: { body?: string; tag?: string; format?: string; private?: boolean } = {}) => {
  const id = (await call("POST", "/api/objects", { type, title })).json.id as string;
  if (extra.body) sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, 0, ?, 'owner')").run(id, extra.body);
  if (extra.tag) await call("POST", `/api/objects/${id}/tags`, { name: extra.tag });
  if (extra.format) sqlite.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES (?, 'format', ?, 'source')").run(id, extra.format);
  if (extra.private) await call("PATCH", `/api/objects/${id}`, { private: true });
  return id;
};
const lookup = async (id: string, pick?: string) => (await call("POST", `/api/objects/${id}/lookup`, pick ? { pick } : {})).json;
const pending = async (id: string) => (await call("GET", `/api/objects/${id}/suggestions`)).json.pending.filter((s: any) => s.kind === "fact") as any[];
const fieldOf = (id: string, f: string) => sqlite.prepare("SELECT * FROM field_values WHERE object_id = ? AND field = ?").get(id, f) as any;

describe("what may leave the Mac", () => {
  it("sends only the title of a readable Object: never its body, Tags, Connections or other Objects", async () => {
    const a = await make("person", "Ursula K. Le Guin", { body: "SECRET-BODY she lived in Portland", tag: "secret-tag-zzz" });
    const other = await make("source", "SECRET-OTHER-OBJECT");
    await call("POST", "/api/connections", { from: a, to: other, kind: "related" });
    await lookup(a);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(new URL(u).protocol).toBe("https:");
      expect(Object.keys(SITES)).toContain(new URL(u).hostname);
      expect(decodeURIComponent(u).toLowerCase()).not.toMatch(/secret|portland/);
    }
    expect(urls[0]).toContain("search=Ursula%20K.%20Le%20Guin"); // the name, and only the name, is what is searched
  });

  it("sends nothing at all about a Private Object or one in the Bin", async () => {
    const priv = await make("person", "Ursula K. Le Guin", { private: true });
    const r = await lookup(priv);
    expect(r.status).toBe("unavailable");
    expect(urls).toEqual([]);
    const binned = await make("person", "Ursula K. Le Guin");
    await call("DELETE", `/api/objects/${binned}`);
    expect((await lookup(binned)).status).toBe("unavailable");
    expect(urls).toEqual([]);
  });

  it("never turns the start of a body into a name: an Object with no title of its own is not looked up", async () => {
    const id = (await call("POST", "/api/objects", { type: "person" })).json.id as string;
    sqlite.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES (?, 0, 'My private diary of Tuesday', 'owner')").run(id);
    expect((await lookup(id)).status).toBe("unavailable");
    expect(urls).toEqual([]);
  });

  it("a Thought is never looked up, and a type of your own needs a property marked 'may be looked up'", async () => {
    const t = await make("thought", "Antifragility");
    expect((await lookup(t)).status).toBe("unavailable");
    const typeKey = (await call("POST", "/api/types", { label: "Idea", color: "ocean", icon: "box" })).json.key as string;
    await call("POST", `/api/types/${typeKey}/fields`, { label: "Notes", input: "longtext" });
    const o = await make(typeKey, "Antifragility");
    expect((await lookup(o)).status).toBe("unavailable");
    expect(urls).toEqual([]);
  });

  it("refuses to speak to a site that is not on the list", async () => {
    await expect(createWebGate({ fetch: fakeFetch }).getJson("https://example.com/x")).rejects.toMatchObject({ kind: "refused" });
    await expect(createWebGate({ fetch: fakeFetch }).getJson("http://en.wikipedia.org/x")).rejects.toMatchObject({ kind: "refused" });
    expect(urls).toEqual([]);
  });
});

describe("what comes back", () => {
  it("is a Suggestion with Source Origin and its link; Approve keeps that; Not this is remembered", async () => {
    const id = await make("person", "Ursula K. Le Guin");
    const r = await lookup(id);
    expect(r).toMatchObject({ status: "ok", count: 3 });
    expect(fieldOf(id, "description")).toBeUndefined(); // nothing is written until the owner approves
    const facts = await pending(id);
    const desc = facts.find((f) => f.field === "description");
    const years = facts.find((f) => f.field === "years");
    expect(desc).toMatchObject({ origin: "source", site: "Wikipedia", url: "https://en.wikipedia.org/wiki/Ursula_K._Le_Guin" });
    expect(desc.value).toContain("best known for her works of speculative fiction");
    expect(years).toMatchObject({ value: "1929–2018", origin: "source", site: "Wikidata", url: "https://www.wikidata.org/wiki/Q181659" });

    await call("POST", `/api/suggestions/${years.id}/approve`);
    const kept = fieldOf(id, "years");
    expect(kept).toMatchObject({ value: "1929–2018", origin: "source", source_url: "https://www.wikidata.org/wiki/Q181659", source_name: "Wikidata", ai_role: null });
    const shown = (await call("GET", `/api/objects/${id}`)).json.fields.find((f: any) => f.key === "years");
    expect(shown).toMatchObject({ origin: "source", sourceUrl: "https://www.wikidata.org/wiki/Q181659", sourceName: "Wikidata" });

    await call("POST", `/api/suggestions/${desc.id}/reject`);
    expect(fieldOf(id, "description")).toBeUndefined();
    urls = [];
    await lookup(id); // the same lookup again: the value turned down, and the one kept, are not offered
    const again = await pending(id);
    expect(again.map((f) => f.field)).toEqual(["links"]);
  });

  it("an owner-written value is never offered over, and editing a looked-up value makes it the owner's", async () => {
    const id = await make("person", "Ursula K. Le Guin");
    await call("PATCH", `/api/objects/${id}`, { fields: { years: "1929 to 2018, in the owner's words" } });
    await lookup(id);
    expect((await pending(id)).map((f) => f.field)).not.toContain("years");
    const l = (await pending(id)).find((f) => f.field === "links");
    await call("POST", `/api/suggestions/${l.id}/approve`);
    await call("PATCH", `/api/objects/${id}`, { fields: { links: "my own link" } });
    expect(fieldOf(id, "links")).toMatchObject({ origin: "owner", source_url: null });
  });

  it("an ambiguous name offers a choice and keeps nothing until the owner chooses; one that is not exact is never taken silently", async () => {
    const id = await make("person", "John Smith");
    const r = await lookup(id);
    expect(r.status).toBe("choose");
    expect(r.candidates).toHaveLength(3);
    expect(await pending(id)).toEqual([]);
    const near = await make("person", "Le Guin");
    expect((await lookup(near)).status).toBe("choose");
    expect(await pending(near)).toEqual([]);
    const ok = await lookup(near, "Q181659");
    expect(ok.status).toBe("ok");
    expect((await pending(near)).length).toBeGreaterThan(0);
    expect((await lookup(id, "Q404")).status).toBe("none"); // a choice that was never offered is not taken
  });

  it("works for a Person, a Concept, a Source (a book) and a type of your own with properties marked", async () => {
    const concept = await make("concept", "Antifragility");
    expect(await lookup(concept)).toMatchObject({ status: "ok", count: 1 });
    expect((await pending(concept))[0]).toMatchObject({ field: "definition", site: "Wikipedia" });

    const book = await make("source", "The Dispossessed", { format: "book" });
    expect(await lookup(book)).toMatchObject({ status: "ok", count: 2 });
    expect((await pending(book)).map((f) => [f.field, f.value, f.site])).toEqual([["authors", "Ursula K. Le Guin", "Open Library"], ["published", "1974", "Open Library"]]);
    expect(urls.some((u) => u.startsWith("https://openlibrary.org/search.json?title=The%20Dispossessed"))).toBe(true);

    const typeKey = (await call("POST", "/api/types", { label: "Place", color: "gold", icon: "box" })).json.key as string;
    await call("POST", `/api/types/${typeKey}/fields`, { label: "About", input: "longtext", lookup: "summary" });
    await call("POST", `/api/types/${typeKey}/fields`, { label: "Since", input: "text", lookup: "year" });
    await call("POST", `/api/types/${typeKey}/fields`, { label: "My rating", input: "text" }); // not marked: never filled
    const place = await make(typeKey, "Tide pools");
    expect(await lookup(place)).toMatchObject({ status: "ok", count: 2 });
    const f = await pending(place);
    expect(f.map((x) => [x.label, x.value, x.site])).toEqual([["About", "Rock pools on a shore.", "Wikidata"], ["Since", "1850", "Wikidata"]]);
  });

  it("an ambiguous book title offers a choice", async () => {
    const book = await make("source", "Dune", { format: "book" });
    const r = await lookup(book);
    expect(r.status).toBe("choose");
    expect(r.candidates.map((c: any) => c.description)).toEqual(["Frank Herbert · 1965", "Brian Herbert · 2010"]);
    expect(await pending(book)).toEqual([]);
  });

  it("only books are looked up for a Source", async () => {
    const article = await make("source", "Dune", { format: "article" });
    expect((await lookup(article)).status).toBe("unavailable");
    expect(urls).toEqual([]);
  });
});

describe("failing quietly", () => {
  it.each([
    ["offline", /Couldn’t reach Wikidata/],
    ["slow", /didn’t answer in time/],
    ["limit", /asked for fewer requests/],
    ["down", /didn’t answer in time/],
  ] as const)("%s gives a plain message and leaves the Object unchanged", async (m, words) => {
    const id = await make("person", "Ursula K. Le Guin");
    const before = JSON.stringify((await call("GET", `/api/objects/${id}`)).json);
    mode = m;
    const r = await lookup(id);
    expect(r.message).toMatch(words);
    expect(r.status).not.toBe("ok");
    expect(await pending(id)).toEqual([]);
    expect(JSON.stringify((await call("GET", `/api/objects/${id}`)).json)).toBe(before);
  });

  it("no match says so, and a lookup uses none of the day's AI calls", async () => {
    const id = await make("person", "Nothingatall");
    const r = await lookup(id);
    expect(r).toMatchObject({ status: "none" });
    expect(r.message).toMatch(/No match/);
    expect(sqlite.prepare("SELECT count(*) AS n FROM ai_jobs").get()).toEqual({ n: 0 });
  });
});

describe("keeping them", () => {
  it("Export includes the value with its Origin and link and still leaves the Bin out; a Backup copy keeps them", async () => {
    const id = await make("person", "Ursula K. Le Guin");
    await lookup(id);
    for (const s of await pending(id)) await call("POST", `/api/suggestions/${s.id}/approve`);
    const gone = await make("person", "Ursula K. Le Guin");
    await call("DELETE", `/api/objects/${gone}`);
    const dir = mkdtempSync(join(tmpdir(), "garden-lookup-export-"));
    const out = await ex.startExport(sqlite, { folder: dir }, { reveal: () => {} } as any);
    expect(out.ok).toBe(true);
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((n) => { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : files.push(p); });
    walk(out.path!);
    const data = JSON.parse(readFileSync(files.find((f) => f.endsWith("garden.json"))!, "utf8"));
    const years = data.objects.find((o: any) => o.id === id).fields.find((f: any) => f.field === "years");
    expect(years).toMatchObject({ origin: "source", sourceUrl: "https://www.wikidata.org/wiki/Q181659", sourceName: "Wikidata" });
    expect(data.objects.some((o: any) => o.id === gone)).toBe(false);
    const md = files.filter((f) => f.endsWith(".md")).map((f) => readFileSync(f, "utf8")).join("\n");
    expect(md).toContain("https://www.wikidata.org/wiki/Q181659");
    // a copy of the database (what a Backup is) carries the same columns
    const copy = sqlite.prepare("SELECT value, source_url FROM field_values WHERE object_id = ? AND field = 'years'").get(id);
    expect(copy).toEqual({ value: "1929–2018", source_url: "https://www.wikidata.org/wiki/Q181659" });
  });
});

describe("the Researcher's web switch", () => {
  let replies: string[], sent: any[];
  const aiFetch = (async (_u: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: replies.shift() ?? "{}" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  let ai: ReturnType<typeof createAi>, clock: Date;
  beforeEach(() => {
    replies = []; sent = []; clock = new Date("2026-11-07T10:00:00Z");
    ai = createAi(sqlite, { gate: createGate({ fetch: aiFetch, key: () => "sk-or-test", baseUrl: "http://pretend" }), web: createWebGate({ fetch: fakeFetch }), now: () => clock, hasKey: () => true });
    app = createApp(sqlite, { readLink: () => {}, ai, web: createWebGate({ fetch: fakeFetch }) });
  });
  const run = async () => { clock = new Date(clock.getTime() + 12_000); return ai.tick(); };
  const answerPair = (answer: string) => { replies.push(JSON.stringify({ read: ["o1"] })); replies.push(JSON.stringify({ answer, connections: [] })); };

  it("is off by default: nothing leaves the Mac for the web", async () => {
    const a = await make("concept", "Antifragility", { body: "Gains from disorder." });
    answerPair("You wrote that it gains from disorder [o0].");
    const inq = (await call("POST", "/api/inquiries", { question: "What is this?", objectId: a })).json;
    expect(inq.web).toBe(false);
    await run();
    const t = (await call("GET", `/api/inquiries/${inq.id}`)).json;
    expect(t.turns[0].state).toBe("done");
    expect(t.turns[0].answer.web).toBeNull();
    expect(urls).toEqual([]);
    expect(JSON.stringify(sent)).not.toMatch(/Web passages/);
  });

  it("with it on, the answer keeps From your Garden and From the web apart, with links, and sends only the title", async () => {
    const a = await make("concept", "Antifragility", { body: "SECRET-BODY gains from disorder.", tag: "secret-tag-zzz" });
    answerPair("**From your Garden.** You wrote that it gains from disorder [o0].\n\n**From the web.** Wikipedia says it is a property of systems that thrive under stress [w1] [w9].");
    const inq = (await call("POST", "/api/inquiries", { question: "What is this?", objectId: a, web: true })).json;
    expect(inq.web).toBe(true);
    await run();
    const t = (await call("GET", `/api/inquiries/${inq.id}`)).json.turns[0];
    expect(t.state).toBe("done");
    expect(t.answer.text).toMatch(/\*\*From your Garden\.\*\*/);
    expect(t.answer.text).toMatch(/\*\*From the web\.\*\* Wikipedia says[^]*\[web 1\]/);
    expect(t.answer.text).not.toMatch(/\[w9\]|\[web 9\]/);
    expect(t.answer.web.sources).toEqual([expect.objectContaining({ n: 1, site: "Wikipedia", url: "https://en.wikipedia.org/wiki/Antifragility" })]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(decodeURIComponent(u).toLowerCase()).not.toMatch(/secret|disorder/);
    expect(JSON.stringify(sent[1].messages)).toMatch(/Web passages/);
  });

  it("an answer that mixes the two parts up is not accepted", async () => {
    const a = await make("concept", "Antifragility", { body: "Gains from disorder." });
    for (let i = 0; i < 3; i++) answerPair("It gains from disorder, and Wikipedia agrees [w1].");
    const inq = (await call("POST", "/api/inquiries", { question: "What is this?", objectId: a, web: true })).json;
    await run();
    expect((await call("GET", `/api/inquiries/${inq.id}`)).json.turns[0].answer).toBeNull();
  });

  it("never looks anything up about a Private Object, and offline it still answers from the Garden with a plain note", async () => {
    const priv = await make("concept", "Antifragility", { body: "mine", private: true });
    expect((await call("POST", "/api/inquiries", { question: "Tell me", objectId: priv, web: true })).status).toBe(400);
    expect(urls).toEqual([]);
    const a = await make("concept", "Antifragility", { body: "Gains from disorder." });
    mode = "offline";
    answerPair("You wrote that it gains from disorder [o0].");
    const inq = (await call("POST", "/api/inquiries", { question: "What is this?", objectId: a, web: true })).json;
    await run();
    const t = (await call("GET", `/api/inquiries/${inq.id}`)).json.turns[0];
    expect(t.state).toBe("done");
    expect(t.answer.web.sources).toEqual([]);
    expect(t.answer.web.notes[0]).toMatch(/Couldn’t look up “Antifragility”/);
  });
});
