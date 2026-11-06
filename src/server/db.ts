import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dbPath, imagesDir } from "./paths.ts";
import * as schema from "./schema.ts";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");

/** Apply any migration files not yet applied. Safe to run on every start. */
export function migrate(sqlite: Database.Database): void {
  sqlite.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)");
  const done = new Set(sqlite.prepare("SELECT name FROM _migrations").all().map((r: any) => r.name));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    sqlite.transaction(() => {
      sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
      sqlite.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
    })();
  }
}

/** Open a database. Pass ":memory:" in tests. */
export function openDb(file: string = dbPath()) {
  if (file !== ":memory:") {
    mkdirSync(dirname(file), { recursive: true });
    mkdirSync(imagesDir(), { recursive: true });
  }
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  migrate(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}
