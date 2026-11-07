import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import * as o from "./objects.ts";
import { capture } from "./capture.ts";
import * as k from "./connections.ts";
import { extractInto } from "./extract.ts";
import { readImage } from "./images.ts";
import * as bin from "./bin.ts";
import { search, briefs } from "./search.ts";
import { timeline } from "./timeline.ts";
import * as tg from "./tags.ts";
import * as ov from "./overview.ts";
import * as dk from "./desk.ts";
import { createAi, type Ai } from "./ai-queue.ts";
import * as sg from "./suggestions.ts";
import * as rs from "./researcher.ts";
import { createGate, forgetKey, GateError, looksLikeKey, saveKey } from "./ai-gate.ts";

type Options = { /** Reads a saved link in the background. Tests replace it. */ readLink?: (id: string, url: string) => void; /** The AI queue. Tests give it a pretend OpenRouter. */ ai?: Ai };

export function createApp(sqlite: Database.Database, opts: Options = {}) {
  const readLink = opts.readLink ?? ((id: string, url: string) => void extractInto(sqlite, id, url));
  const ai = opts.ai ?? createAi(sqlite, { gate: createGate() });
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof o.BadRequest) return c.json({ error: err.message }, 400);
    console.error(err);
    return c.json({ error: "Something went wrong inside the Garden." }, 500);
  });

  app.get("/api/health", (c) =>
    c.json({ ok: true, objects: (sqlite.prepare("SELECT count(*) AS n FROM objects WHERE deleted_at IS NULL").get() as any).n }),
  );

  app.get("/api/types", (c) => c.json(o.listTypes(sqlite)));

  // The filters and sort every list shares (issue #33).
  const filtersOf = (c: any) => ({ type: c.req.query("type"), tag: c.req.query("tag"), since: c.req.query("since"), until: c.req.query("until"), unreviewed: c.req.query("unreviewed"), noConnections: c.req.query("noConnections"), sort: c.req.query("sort") });
  app.get("/api/objects", (c) => c.json(o.listObjects(sqlite, filtersOf(c))));
  // The owner's search over everything they can see, Private included, and the recent items for ⌘K.
  app.get("/api/find", (c) => c.json(search(sqlite, { ...filtersOf(c), q: c.req.query("q"), limit: Number(c.req.query("limit")) || undefined })));
  app.get("/api/recent", (c) => c.json(briefs(sqlite, (c.req.query("ids") ?? "").split(",").filter((x) => /^[0-9a-f-]{36}$/.test(x)))));
  app.get("/api/timeline", (c) => c.json(timeline(sqlite, { before: c.req.query("before"), limit: Number(c.req.query("limit")) || undefined })));
  app.post("/api/objects", async (c) => c.json(o.createObject(sqlite, await c.req.json().catch(() => ({}))), 201));
  // Capture takes JSON (words and links) or a form with the same JSON in "payload" plus picture files in "images".
  app.post("/api/capture", async (c) => {
    let input: any = {};
    if ((c.req.header("content-type") ?? "").includes("multipart/form-data")) {
      const form = await c.req.formData();
      input = JSON.parse(String(form.get("payload") ?? "{}"));
      input.images = await Promise.all(
        form.getAll("images").filter((f): f is File => typeof f !== "string").map(async (f) => ({ name: f.name || "Pasted image", bytes: Buffer.from(await f.arrayBuffer()) })),
      );
    } else input = await c.req.json().catch(() => ({}));
    const result = await capture(sqlite, input, readLink);
    // The words are saved. Only now is the Archivist asked to look (in about 2 minutes). Private ones are never queued.
    ai.enqueueCaptured(result.created.map((x) => x.id));
    return c.json(result, 201);
  });
  app.get("/api/images/:id/:kind", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "Not found" }, 404);
    try {
      return new Response(new Uint8Array(await readImage(id, c.req.param("kind") === "thumb")), { headers: { "content-type": "image/jpeg", "cache-control": "max-age=86400" } });
    } catch { return c.json({ error: "Not found" }, 404); }
  });
  app.post("/api/reviewed", async (c) => c.json(o.markReviewed(sqlite, (await c.req.json().catch(() => ({}))).ids)));
  // An Object with the Mentions its body makes, so the editor can draw them.
  const withMentions = (obj: ReturnType<typeof o.getObject>) => (obj ? { ...obj, mentions: k.mentionInfo(sqlite, obj.id) } : null);
  const found = (c: any, obj: unknown) => (obj ? c.json(obj) : c.json({ error: "Not found" }, 404));
  app.get("/api/objects/:id", (c) => found(c, withMentions(o.getObject(sqlite, c.req.param("id")))));
  app.patch("/api/objects/:id", async (c) => found(c, withMentions(o.updateObject(sqlite, c.req.param("id"), await c.req.json().catch(() => ({}))))));
  app.delete("/api/objects/:id", (c) => (o.deleteObject(sqlite, c.req.param("id")) ? c.json({ deleted: true }) : c.json({ error: "Not found" }, 404)));
  // The Bin (issue #30)
  app.get("/api/bin", (c) => c.json(bin.listBin(sqlite)));
  app.post("/api/bin/empty", (c) => c.json({ purged: bin.emptyBin(sqlite) }));
  app.post("/api/objects/:id/restore", (c) => (bin.restoreObject(sqlite, c.req.param("id")) ? c.json({ restored: true }) : c.json({ error: "Not found" }, 404)));
  app.delete("/api/bin/:id", (c) => (bin.purgeObjects(sqlite, [c.req.param("id")]) ? c.json({ purged: 1 }) : c.json({ error: "Not found" }, 404)));
  app.put("/api/objects/:id/body", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const saved = o.setBody(sqlite, c.req.param("id"), body.paragraphs);
    if (saved) dk.saveVersion(sqlite, saved.id); // a Concept's view is kept by day (issue #35)
    return found(c, withMentions(saved));
  });

  // Connections (issue #7)
  app.get("/api/search", (c) =>
    c.json(k.searchObjects(sqlite, { q: c.req.query("q"), type: c.req.query("type"), exclude: c.req.query("exclude"), limit: Number(c.req.query("limit")) || undefined })),
  );
  app.get("/api/connection-kinds", (c) => c.json(k.kindChoices));
  app.get("/api/objects/:id/connections", (c) => found(c, k.connectionsOf(sqlite, c.req.param("id"))));
  app.get("/api/objects/:id/shares-words", (c) => found(c, k.sharesWords(sqlite, c.req.param("id"))));
  app.post("/api/connections", async (c) => c.json(k.connect(sqlite, await c.req.json().catch(() => ({}))), 201));
  app.patch("/api/connections/:id", async (c) => {
    const r = k.updateConnection(sqlite, Number(c.req.param("id")), await c.req.json().catch(() => ({})));
    return found(c, r);
  });
  // Removing answers with what was removed, so the page can offer Undo.
  app.delete("/api/connections/:id", (c) => {
    const id = Number(c.req.param("id"));
    const was = sqlite.prepare("SELECT * FROM connections WHERE id = ?").get(id) as any;
    if (!k.disconnect(sqlite, id)) return c.json({ error: "Not found" }, 404);
    return c.json({ removed: true, was: { fromId: was.from_id, toId: was.to_id, kind: was.kind, note: was.note, origin: was.origin, aiRole: was.ai_role, aiModel: was.ai_model, aiDate: was.ai_date, approved: !!was.approved } });
  });
  app.post("/api/connections/restore", async (c) => c.json(bin.restoreConnection(sqlite, await c.req.json().catch(() => ({}))), 201));
  // Merge two Objects of the same type into the kept one. If two Connections disagree it answers 409 with what to ask.
  app.post("/api/objects/:id/merge", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = k.mergeObjects(sqlite, c.req.param("id"), String(body.from ?? ""), body.picks ?? {});
    return "needsChoice" in r ? c.json(r, 409) : c.json(r);
  });

  app.post("/api/objects/:id/tags", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const obj = o.addTag(sqlite, c.req.param("id"), body.name);
    return obj ? c.json(obj) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/objects/:id/tags/:tagId/restore", async (c) =>
    bin.restoreTagOn(sqlite, c.req.param("id"), Number(c.req.param("tagId")), await c.req.json().catch(() => ({}))) ? c.json(o.getObject(sqlite, c.req.param("id"))) : c.json({ error: "Not found" }, 404));
  app.delete("/api/objects/:id/tags/:tagId", (c) => c.json(o.removeTag(sqlite, c.req.param("id"), Number(c.req.param("tagId")))));
  app.delete("/api/tags/:id", (c) => found(c, bin.deleteTag(sqlite, Number(c.req.param("id")))));
  app.post("/api/tags/restore", async (c) => c.json(bin.restoreTag(sqlite, await c.req.json().catch(() => ({}))), 201));
  app.get("/api/tags", (c) => c.json(o.listTags(sqlite)));
  app.post("/api/tags/:id/rename", async (c) => {
    const r = tg.renameTag(sqlite, Number(c.req.param("id")), (await c.req.json().catch(() => ({}))).name);
    return r ? c.json(r) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/tags/:id/rename/undo", async (c) => c.json(tg.undoRename(sqlite, Number(c.req.param("id")), await c.req.json().catch(() => ({})))));
  app.post("/api/tags/:id/merge", async (c) => {
    const r = tg.mergeTags(sqlite, Number(c.req.param("id")), Number((await c.req.json().catch(() => ({}))).into));
    return r ? c.json(r) : c.json({ error: "Not found" }, 404);
  });
  // The Overview and Turn into Concept (issue #34)
  app.get("/api/overview", (c) => c.json(ov.overview(sqlite)));
  app.get("/api/objects/:id/light-up", (c) => found(c, ov.lightUp(sqlite, c.req.param("id"))));
  app.post("/api/tags/:id/concept", async (c) => {
    const r = ov.turnIntoConcept(sqlite, Number(c.req.param("id")), await c.req.json().catch(() => ({})));
    return r ? c.json(r, 201) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/concepts/undo", async (c) => c.json(ov.undoTurnIntoConcept(sqlite, await c.req.json().catch(() => ({})), bin.restoreTag)));
  // The Concept page as a Distill desk, Open Questions and "From your Garden" (issue #35)
  app.get("/api/concepts/:id/desk", (c) => found(c, dk.deskOf(sqlite, c.req.param("id"))));
  app.get("/api/objects/:id/question", (c) => c.json(dk.questionOf(sqlite, c.req.param("id"))));
  app.put("/api/objects/:id/question", async (c) => {
    const r = dk.setQuestion(sqlite, c.req.param("id"), await c.req.json().catch(() => ({})));
    return r === undefined ? c.json({ error: "Not found" }, 404) : c.json(r);
  });
  app.get("/api/questions", (c) => c.json(dk.allQuestions(sqlite)));
  app.post("/api/thoughts/about", async (c) => c.json({ id: dk.thoughtAbout(sqlite, await c.req.json().catch(() => ({}))) }, 201));
  app.get("/api/garden", (c) => c.json(dk.fromYourGarden(sqlite)));
  app.post("/api/garden/dismiss", async (c) => c.json(dk.dismissFromGarden(sqlite, (await c.req.json().catch(() => ({}))).id)));
  app.post("/api/tags/unmerge", async (c) => c.json(tg.undoMerge(sqlite, await c.req.json().catch(() => ({})))));
  app.patch("/api/tags/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(o.setTagColor(sqlite, Number(c.req.param("id")), body.color));
  });

  // The AI (issue #31)
  app.get("/api/ai", (c) => c.json(ai.summary()));
  app.put("/api/ai/key", async (c) => {
    const key = (await c.req.json().catch(() => ({}))).key;
    if (!looksLikeKey(key)) throw new o.BadRequest("That doesn't look like an OpenRouter key. It starts with sk-or-");
    try { await createGate().account(key.trim()); }
    catch (e) {
      if (e instanceof GateError && e.kind === "key") throw new o.BadRequest("OpenRouter did not accept that key. Check you copied all of it.");
      throw new o.BadRequest("Couldn't reach OpenRouter to check the key. Nothing was saved; try again in a moment.");
    }
    saveKey(key);
    await ai.refreshAccount();
    return c.json(ai.summary());
  });
  app.delete("/api/ai/key", (c) => { forgetKey(); return c.json(ai.summary()); });
  app.post("/api/ai/flush", (c) => c.json({ released: ai.flushCaptures() }));
  app.get("/api/objects/:id/ai", (c) => found(c, ai.statusOf(c.req.param("id"))));
  app.post("/api/objects/:id/ai/run", (c) => (ai.request(c.req.param("id")) ? c.json(ai.statusOf(c.req.param("id"))) : c.json({ error: "The Archivist can't read this one" }, 400)));
  app.post("/api/objects/:id/ai/undo", (c) => (ai.undo(c.req.param("id")) ? c.json(o.getObject(sqlite, c.req.param("id"))) : c.json({ error: "Nothing to undo" }, 404)));

  // Suggestions and AI Notes (issue #32)
  app.get("/api/objects/:id/suggestions", (c) => found(c, sg.suggestionsOf(sqlite, c.req.param("id"))));
  app.post("/api/suggestions/:id/approve", (c) => {
    const objectId = sg.approve(sqlite, Number(c.req.param("id")));
    return objectId ? c.json(withMentions(o.getObject(sqlite, objectId))) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/suggestions/:id/reject", (c) => {
    const objectId = sg.reject(sqlite, Number(c.req.param("id")));
    return objectId ? c.json({ rejected: true }) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/objects/:id/ai/forget-rejected", (c) => c.json({ forgotten: sg.forgetRejected(sqlite, c.req.param("id")) }));
  app.get("/api/objects/:id/ai-notes", (c) => found(c, sg.notesOf(sqlite, c.req.param("id"))));
  app.delete("/api/ai-notes/:id", (c) => { const n = sg.deleteNote(sqlite, Number(c.req.param("id"))); return n ? c.json({ removed: true, was: n }) : c.json({ error: "Not found" }, 404); });
  app.post("/api/ai-notes/restore", async (c) => c.json(sg.restoreNote(sqlite, await c.req.json().catch(() => ({}))), 201));
  app.post("/api/ai-notes/:id/thought", (c) => { const id = sg.startThoughtFromNote(sqlite, Number(c.req.param("id"))); return id ? c.json(withMentions(o.getObject(sqlite, id)), 201) : c.json({ error: "Not found" }, 404); });

  // The Researcher and Inquiries (issue #36). A question is saved first; only then is it queued.
  const hasKey = () => ai.summary().keySet;
  const threadOf = (id: string) => rs.inquiryOf(sqlite, id, hasKey());
  app.get("/api/inquiries", (c) => c.json(rs.listInquiries(sqlite)));
  app.get("/api/objects/:id/inquiries", (c) => c.json(rs.listInquiries(sqlite, c.req.param("id"))));
  app.post("/api/inquiries", async (c) => {
    const { id, turnId } = rs.createInquiry(sqlite, await c.req.json().catch(() => ({})));
    ai.askResearcher(turnId);
    return c.json(threadOf(id), 201);
  });
  app.get("/api/inquiries/:id", (c) => found(c, threadOf(c.req.param("id"))));
  app.post("/api/inquiries/:id/turns", async (c) => {
    const turnId = rs.addTurn(sqlite, c.req.param("id"), (await c.req.json().catch(() => ({}))).question);
    if (!turnId) return c.json({ error: "Not found" }, 404);
    ai.askResearcher(turnId);
    return c.json(threadOf(c.req.param("id")), 201);
  });
  app.delete("/api/inquiries/:id", (c) => (rs.deleteInquiry(sqlite, c.req.param("id")) ? c.json({ deleted: true }) : c.json({ error: "Not found" }, 404)));
  app.post("/api/inquiries/:id/restore", (c) => (rs.restoreInquiry(sqlite, c.req.param("id")) ? c.json({ restored: true }) : c.json({ error: "Not found" }, 404)));
  app.get("/api/bin/inquiries", (c) => c.json(rs.listBinInquiries(sqlite)));
  app.delete("/api/bin/inquiries/:id", (c) => (rs.purgeInquiries(sqlite, [c.req.param("id")]) ? c.json({ purged: 1 }) : c.json({ error: "Not found" }, 404)));
  app.post("/api/turns/:id/cancel", (c) => c.json({ cancelled: ai.cancelQuestion(Number(c.req.param("id"))) }));
  app.post("/api/turns/:id/retry", (c) => {
    const id = Number(c.req.param("id"));
    if (!rs.resetTurn(sqlite, id)) return c.json({ error: "Not found" }, 404);
    ai.askResearcher(id);
    return c.json({ asked: true });
  });
  app.post("/api/turns/:id/keep", async (c) => {
    const kept = rs.keepAnswer(sqlite, Number(c.req.param("id")), (await c.req.json().catch(() => ({}))).objectIds);
    return kept ? c.json({ kept }) : c.json({ error: "Not found" }, 404);
  });
  app.post("/api/turns/:id/thought", (c) => { const id = rs.thoughtFromTurn(sqlite, Number(c.req.param("id"))); return id ? c.json({ id }, 201) : c.json({ error: "Not found" }, 404); });

  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("*", serveStatic({ path: "./dist/web/index.html" }));
  return app;
}
