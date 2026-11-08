// Phone bot setup (issue #38): the one-time code the Garden shows on the Mac.
// The owner pastes it into the Apps Script's settings (docs/phone-bot-setup.md). The bot answers only the account that sends
// `/start <code>`. The bot's own key (from BotFather) is never stored here.
import { randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gardenDir } from "./paths.ts";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
const file = () => join(gardenDir(), "phone-setup.json");
const newCode = () => { const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""); return `${c.slice(0, 4)}-${c.slice(4)}`; };
const save = (code: string) => { writeFileSync(file(), JSON.stringify({ code }), { mode: 0o600 }); return { code }; };

export type PhoneSetup = { code: string };

export function phoneSetup(): PhoneSetup {
  try {
    if (existsSync(file())) {
      const s = JSON.parse(readFileSync(file(), "utf8"));
      if (typeof s.code === "string") return { code: s.code };
    }
  } catch {}
  return save(newCode());
}
/** A fresh one-time code. */
export const renewCode = (): PhoneSetup => save(newCode());
