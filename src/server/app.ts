import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";

export function createApp(sqlite: Database.Database) {
  const app = new Hono();
  app.get("/api/health", (c) =>
    c.json({ ok: true, objects: (sqlite.prepare("SELECT count(*) AS n FROM objects WHERE deleted_at IS NULL").get() as any).n }),
  );
  app.use("/*", serveStatic({ root: "./dist/web" }));
  app.get("*", serveStatic({ path: "./dist/web/index.html" }));
  return app;
}
