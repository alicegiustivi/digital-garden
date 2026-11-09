// Backup tools for the owner's terminal and for the agent that restores the Garden (issue #39).
//   npm run backup:password        remember the backup password in the Mac's Keychain (typed hidden; nothing is shown or saved elsewhere)
//   npm run backup -- now          make a Backup now
//   npm run backup -- list         the days that can be restored
//   npm run backup -- test-restore restore the newest Backup into a spare folder and check it
//   npm run backup -- restore <latest|YYYY-MM-DD> <empty-folder>
//   npm run backup -- bring-back <latest|YYYY-MM-DD> "<title or id>" [--look]   copy ONE Object back from that day's Backup, tagged restored-<day>
// The password comes from the Keychain; if it isn't there (a new Mac) you are asked for it, typed hidden.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import Database from "better-sqlite3";
import { openDb } from "./db.ts";
import { bringBack } from "./bring-back.ts";
import { imagesDir } from "./paths.ts";
import { backupDays, backupDir, backupStatus, keychainPassword, restoreBackup, runBackup, KEYCHAIN_SERVICE } from "./backup.ts";

function askHidden(q: string): Promise<string> {
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const w = (rl as any)._writeToOutput;
    (rl as any)._writeToOutput = (s: string) => { if (s.includes(q)) w.call(rl, s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}
const folderOrExit = () => { const f = backupDir(); if (!f) { console.error("No Backup folder is set. Set it in the Garden under More ▸ Backup."); process.exit(1); } return f; };
const passwordOrAsk = async () => (await keychainPassword()) ?? (await askHidden("Backup password: "));

const [cmd = "status", ...args] = process.argv.slice(2);
if (cmd === "password") {
  // macOS's own tool prompts for the password itself (hidden, twice); this program never sees it.
  const r = spawnSync("/usr/bin/security", ["add-generic-password", "-U", "-a", "garden", "-s", KEYCHAIN_SERVICE, "-w"], { stdio: "inherit" });
  console.log(r.status === 0 ? "Saved in your Mac's Keychain. Write the password down somewhere safe too: without it a Backup cannot be opened." : "Not saved.");
  process.exit(r.status ?? 1);
} else if (cmd === "status") {
  console.log(JSON.stringify(backupStatus(), null, 2));
} else if (cmd === "now") {
  const { sqlite } = openDb();
  const r = await runBackup(sqlite, { password: keychainPassword });
  console.log(r.message); process.exit(r.ok ? 0 : 1);
} else if (cmd === "list") {
  console.log((await backupDays(folderOrExit())).join("\n"));
} else if (cmd === "test-restore" || cmd === "restore") {
  const test = cmd === "test-restore";
  const into = test ? mkdtempSync(join(tmpdir(), "garden-test-restore-")) : args[1];
  if (!into) { console.error("Usage: restore <latest|YYYY-MM-DD> <empty-folder>"); process.exit(1); }
  try {
    const r = await restoreBackup(folderOrExit(), await passwordOrAsk(), into, (test ? "latest" : args[0] ?? "latest") as string);
    console.log(`Restored the Backup of ${r.day} into ${r.into}\n  database check: ${r.integrity}\n  Objects found: ${r.objects}\n  images restored: ${r.images}${r.imagesMissing ? ` (${r.imagesMissing} missing from Drive)` : ""}`);
    if (test) { rmSync(into, { recursive: true, force: true }); console.log("The spare copy was deleted again."); }
    process.exit(r.integrity === "ok" && !r.imagesMissing ? 0 : 1);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
} else if (cmd === "bring-back") {
  const look = args.includes("--look");
  const [when = "latest", ...rest] = args.filter((a) => a !== "--look");
  const query = rest.join(" ").trim();
  if (!query) { console.error('Usage: bring-back <latest|YYYY-MM-DD> "<title or id>" [--look]'); process.exit(1); }
  // The Backup is opened in a spare folder that is deleted again; the live Garden is only added to, never replaced.
  const spareDir = mkdtempSync(join(tmpdir(), "garden-bring-back-"));
  try {
    const r = await restoreBackup(folderOrExit(), await passwordOrAsk(), spareDir, when);
    const spare = new Database(join(spareDir, "garden.db"), { readonly: true });
    const { sqlite } = openDb();
    const out = bringBack(spare, sqlite, r.day, query, { spareImages: join(spareDir, "images"), liveImages: imagesDir(), lookOnly: look });
    spare.close();
    if (out.status === "not-found") { console.error(`Nothing called "${query}" in the Backup of ${r.day}.`); process.exit(1); }
    if (out.status === "several") { console.error(`Several Objects match "${query}" in the Backup of ${r.day}. Run again with the id of the one you want:`); for (const m of out.matches) console.error(`  ${m.id}  ${m.type}  ${m.title}${m.deleted ? "  (was in the Bin then)" : ""}`); process.exit(2); }
    if (out.status === "already-there") { console.error(out.inBin ? "That Object is in the Garden's Bin. Open the Bin (More ▸ Bin) and press Restore instead." : "That Object is already in the Garden, so nothing was changed."); process.exit(1); }
    if (out.status === "would") { console.log(`Would bring back "${out.match.title}" (${out.match.type}) from the Backup of ${r.day}. Nothing was changed.`); process.exit(0); }
    console.log(`Brought back "${out.title}" from the Backup of ${r.day}, tagged "${out.tag}".${out.connectionsSkipped ? ` ${out.connectionsSkipped} Connection(s) to Objects no longer in the Garden were left out.` : ""}`);
  } catch (e) { console.error((e as Error).message); process.exit(1); }
  finally { rmSync(spareDir, { recursive: true, force: true }); }
} else { console.error("Unknown command"); process.exit(1); }
