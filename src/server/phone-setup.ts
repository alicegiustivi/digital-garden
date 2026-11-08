// Phone bot setup (issue #38): the one-time code and the web-address secret that the Garden shows on the Mac.
// The owner pastes both into the Apps Script's settings (docs/phone-bot-setup.md). They protect the bot only; the bot's own key
// (from BotFather) is never stored here. The bot answers only the account that sends `/start <code>`.
import { randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gardenDir } from "./paths.ts";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const file = () => join(gardenDir(), "phone-setup.json");
const newCode = () => { const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""); return `${c.slice(0, 4)}-${c.slice(4)}`; };

export type PhoneSetup = { code: string; secret: string };

export function phoneSetup(): PhoneSetup {
  try {
    if (existsSync(file())) {
      const s = JSON.parse(readFileSync(file(), "utf8"));
      if (typeof s.code === "string" && typeof s.secret === "string") return { code: s.code, secret: s.secret };
    }
  } catch {}
  const s = { code: newCode(), secret: randomBytes(24).toString("hex") };
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  return s;
}
/** A fresh one-time code (the web-address secret stays: changing it means connecting the bot again). */
export function renewCode(): PhoneSetup {
  const s = { ...phoneSetup(), code: newCode() };
  writeFileSync(file(), JSON.stringify(s), { mode: 0o600 });
  return s;
}
