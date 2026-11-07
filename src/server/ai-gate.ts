// THE AI GATE. This is the only file in the Garden that talks to OpenRouter (the outside AI service).
// Everything the AI is asked goes through `chat` below, and `chat` refuses any model that isn't free.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gardenDir } from "./paths.ts";

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type Message = { role: "system" | "user"; content: string | Part[] };

/**
 * busy    = the free model is full or slow: just try again later (never shown as a failure)
 * daily   = today's free allowance is used up
 * key     = OpenRouter doesn't accept the key (missing, wrong, or out of allowance)
 * missing = no key has been given yet
 * bad     = this model won't take the request (gone, or refused it)
 * refused = our own rule: not a ":free" model. Nothing was sent.
 */
export class GateError extends Error {
  constructor(public kind: "busy" | "daily" | "key" | "missing" | "bad" | "refused", message: string, public resetAt?: number) { super(message); }
}

export const isFreeModel = (m: unknown): m is string => typeof m === "string" && /^[\w.\-]+\/[\w.\-:]+:free$/.test(m);

// The key lives in its own file inside the Garden folder (never in the code, never in the database or its backups).
export const keyPath = () => join(gardenDir(), "openrouter.key");
export function readKey(): string | null {
  const env = process.env.OPENROUTER_API_KEY?.trim();
  if (env) return env;
  try { return readFileSync(keyPath(), "utf8").trim() || null; } catch { return null; }
}
export function saveKey(key: string) {
  mkdirSync(dirname(keyPath()), { recursive: true });
  writeFileSync(keyPath(), key.trim() + "\n", { mode: 0o600 });
  chmodSync(keyPath(), 0o600);
}
export const forgetKey = () => { if (existsSync(keyPath())) rmSync(keyPath()); };
export const looksLikeKey = (k: unknown): k is string => typeof k === "string" && /^sk-or-[A-Za-z0-9_\-]{16,}$/.test(k.trim());

export type Account = { used: number; limit: number; remaining: number };
type Deps = { fetch?: typeof fetch; key?: () => string | null; baseUrl?: string };

export function createGate(deps: Deps = {}) {
  const doFetch = deps.fetch ?? fetch;
  const key = deps.key ?? readKey;
  // GARDEN_AI_BASE_URL exists so a practice run can talk to a pretend OpenRouter on this Mac.
  const base = deps.baseUrl ?? process.env.GARDEN_AI_BASE_URL ?? "https://openrouter.ai/api/v1";

  const headers = (k: string) => ({ authorization: `Bearer ${k}`, "content-type": "application/json", "x-title": "Digital Garden" });
  const resetOf = (res: Response) => {
    const v = Number(res.headers.get("x-ratelimit-reset"));
    return Number.isFinite(v) && v > 0 ? v : undefined; // milliseconds since 1970, per OpenRouter's docs
  };
  const fail = (res: Response, body: any): GateError => {
    const s = res.status;
    const msg = String(body?.error?.message ?? res.statusText ?? s);
    if (s === 401 || s === 403) return new GateError("key", "OpenRouter did not accept the key.");
    if (s === 402) return new GateError("key", "OpenRouter says this account has no allowance left for that.");
    if (s === 429) {
      const out = res.headers.get("x-ratelimit-remaining") === "0" || /per-day|per day|daily/i.test(msg);
      return out ? new GateError("daily", "Today's free calls are used up.", resetOf(res)) : new GateError("busy", "The free model is busy.");
    }
    if (s === 408 || s >= 500) return new GateError("busy", "The free model is busy.");
    return new GateError("bad", msg);
  };

  return {
    /** Ask one free model. Returns its text. */
    async chat(model: string, messages: Message[]): Promise<string> {
      if (!isFreeModel(model)) throw new GateError("refused", `Refused: ${String(model)} is not a free model.`);
      const k = key();
      if (!k) throw new GateError("missing", "No OpenRouter key yet.");
      let res: Response;
      try {
        res = await doFetch(`${base}/chat/completions`, {
          method: "POST", headers: headers(k), signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 700 }),
        });
      } catch { throw new GateError("busy", "Could not reach OpenRouter."); }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(res, body);
      // OpenRouter sometimes answers 200 with an error inside.
      if (body?.error) {
        const code = Number(body.error.code);
        throw new GateError(code === 401 || code === 403 ? "key" : code === 429 || code >= 500 || !code ? "busy" : "bad", String(body.error.message ?? "error"));
      }
      const text = body?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) throw new GateError("bad", "The model sent back nothing.");
      return text;
    },

    /** The key's own free-call count, from OpenRouter. Used to check a pasted key and to show "calls left". */
    async account(keyOverride?: string): Promise<Account> {
      const k = keyOverride ?? key();
      if (!k) throw new GateError("missing", "No OpenRouter key yet.");
      let res: Response;
      try { res = await doFetch(`${base}/key`, { headers: headers(k), signal: AbortSignal.timeout(20_000) }); }
      catch { throw new GateError("busy", "Could not reach OpenRouter."); }
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok) throw fail(res, body);
      const f = body?.data?.free_model_daily_requests;
      const limit = Number(f?.limit ?? 1000), used = Number(f?.used ?? 0);
      return { used, limit, remaining: Number.isFinite(Number(f?.remaining)) ? Number(f.remaining) : Math.max(0, limit - used) };
    },
  };
}
export type Gate = ReturnType<typeof createGate>;
