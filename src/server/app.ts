import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import * as o from "./objects.ts";

export function createApp(sqlite: Database.Database) {
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

  app.get("/api/objects", (c) =>
    c.json(o.listObjects(sqlite, { type: c.req.query("type"), tag: c.req.query("tag"), since: c.req.query("since") })),
  );
  app.post("/api/objects", async (c) => c.json(o.createObject(sqlite, await c.req.json().catch(() => ({}))), 201));
  app.post("/api/capture", async (c) => c.json(o.captureText(sqlite, await c.req.json().catch(() => ({}))), 201));
  app.get("/api/objects/:id", (c) => {
    const obj = o.getObject(sqlite, c.req.param("id"));
    return obj ? c.json(obj) : c.json({ error: "Not found" }, 404);
  });
  app.patch("/api/objects/:id", async (c) => {
    const obj = o.updateObject(sqlite, c.req.param("id"), await c.req.json().catch(() => ({})));
    return obj ? c.json(obj) : c.json({ error: "Not found" }, 404);
  });
  app.put("/api/objects/:id/body", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const obj = o.setBody(sqlite, c.req.param("id"), body.paragraphs);
    return obj ? c.json(obj) : c.json({ error: "Not found" }, 404);
  });

  app.post("/api/objects/:id/tags", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const obj = o.addTag(sqlite, c.req.param("id"), body.name);
    return obj ? c.json(obj) : c.json({ error: "Not found" }, 404);
  });
  app.delete("/api/objects/:id/tags/:tagId", (c) => c.json(o.removeTag(sqlite, c.req.param("id"), Number(c.req.param("tagId")))));
  app.get("/api/tags", (c) => c.json(o.listTags(sqlite)));
  app.patch("/api/tags/:id", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(o.setTagColor(sqlite, Number(c.req.param("id")), body.color));
  });

  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("*", serveStatic({ path: "./dist/web/index.html" }));
  return app;
}
