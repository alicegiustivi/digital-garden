import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { resumeReading } from "./extract.ts";
import { gardenDir } from "./paths.ts";
import { purgeExpired } from "./bin.ts";
import { createAi } from "./ai-queue.ts";
import { createGate } from "./ai-gate.ts";

const PORT = Number(process.env.GARDEN_PORT ?? 4747);
// 127.0.0.1 = this Mac only. Other devices on the network cannot connect (ADR 0002).
const HOST = "127.0.0.1";

const { sqlite } = openDb();
resumeReading(sqlite);
// Anything that has sat in the Bin for 30 days goes for good: checked now, then once an hour.
purgeExpired(sqlite);
setInterval(() => purgeExpired(sqlite), 36e5).unref();
// The Archivist works through its queue whenever the Garden is open. If the Mac is off, the work simply waits.
const ai = createAi(sqlite, { gate: createGate() });
ai.start();
serve({ fetch: createApp(sqlite, { ai, inboxEvery: 30_000 }).fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Garden is open at http://${HOST}:${PORT}  (data: ${gardenDir()})`);
});
