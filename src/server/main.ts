import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { resumeReading } from "./extract.ts";
import { gardenDir } from "./paths.ts";

const PORT = Number(process.env.GARDEN_PORT ?? 4747);
// 127.0.0.1 = this Mac only. Other devices on the network cannot connect (ADR 0002).
const HOST = "127.0.0.1";

const { sqlite } = openDb();
resumeReading(sqlite);
serve({ fetch: createApp(sqlite).fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Garden is open at http://${HOST}:${PORT}  (data: ${gardenDir()})`);
});
