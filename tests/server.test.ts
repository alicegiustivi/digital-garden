import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openDb } from "../src/server/db.ts";
import { createApp } from "../src/server/app.ts";

describe("local server", () => {
  it("answers health with an empty Garden", async () => {
    const res = await createApp(openDb(":memory:").sqlite).request("/api/health");
    expect(await res.json()).toEqual({ ok: true, objects: 0 });
  });
  it("only listens on this Mac (127.0.0.1)", () => {
    expect(readFileSync("src/server/main.ts", "utf8")).toMatch(/HOST = "127\.0\.0\.1"/);
  });
});
