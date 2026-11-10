import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

describe("local server", () => {
  it("answers health with an empty Garden", async () => {
    const res = await createApp(openDb(":memory:").sqlite).request("/api/health");
    expect(await res.json()).toEqual({ ok: true, objects: 0 });
  });
  it("refuses a request that names another Host or comes from another web page (ADR 0002)", async () => {
    const app = createApp(openDb(":memory:").sqlite);
    for (const h of ["127.0.0.1:4747", "localhost:4747", "[::1]:4747"]) expect((await app.request("/api/health", { headers: { host: h } })).status).toBe(200);
    expect((await app.request("/api/health", { headers: { host: "evil.example:4747" } })).status).toBe(403);
    expect((await app.request("/api/health", { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await app.request("/api/health", { headers: { origin: "http://127.0.0.1:4747" } })).status).toBe(200);
  });
  it("only listens on this Mac (127.0.0.1)", () => {
    expect(readFileSync("src/server/main.ts", "utf8")).toMatch(/HOST = "127\.0\.0\.1"/);
  });
});
