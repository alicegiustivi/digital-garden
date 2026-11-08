import { homedir } from "node:os";
import { join } from "node:path";

/** Where the Garden's data lives. Never inside the code repo (ADR 0002). */
export function gardenDir(): string {
  return process.env.GARDEN_DIR ?? join(homedir(), "Garden");
}
export const dbPath = () => join(gardenDir(), "garden.db");
export const imagesDir = () => join(gardenDir(), "images");
/** Where the owner says Google Drive puts phone captures (a folder on the Mac). Set in the Garden, or with GARDEN_INBOX_DIR. */
export const inboxSettingPath = () => join(gardenDir(), "inbox-folder.txt");
