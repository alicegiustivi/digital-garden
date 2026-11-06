import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import * as o from "./objects.ts";
import { capture } from "./capture.ts";
import { extractInto } from "./extract.ts";
import { readImage } from "./images.ts";

type Options = { /** Reads a saved link in the background. Tests replace it. */ readLink?: (id: string, url: string) => void };

export function createApp(sqlite: Database.Database, opts: Options = {}) {
  const readLink = opts.readLink ?? ((id: string, url: string) => void extractInto(sqlite, id, url));
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
    c.json(o.listObjects(sqlite, { type: c.req.query("type"), tag: c.req.query("tag"), since: c.req.query("since"), unreviewed: c.req.query("unreviewed") })),
  );
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
    return c.json(await capture(sqlite, input, readLink), 201);
  });
  app.get("/api/images/:id/:kind", async (c) => {
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/.test(id)) return c.json({ error: "Not found" }, 404);
    try {
      return new Response(new Uint8Array(await readImage(id, c.req.param("kind") === "thumb")), { headers: { "content-type": "image/jpeg", "cache-control": "max-age=86400" } });
    } catch { return c.json({ error: "Not found" }, 404); }
  });
  app.post("/api/reviewed", async (c) => c.json(o.markReviewed(sqlite, (await c.req.json().catch(() => ({}))).ids)));
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
