// The AI queue: all AI work waits here in order and is done one call at a time, inside the free allowance.
// Order (issue #31): a Researcher question the owner is waiting on, then something the owner asked for, then the oldest
// capture. Content is always saved BEFORE a job is made, and a job only ever adds marked AI Contributions afterwards,
// so a failed step can never touch the content and can always be tried again.
import type Database from "better-sqlite3";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AI_CONFIG, type AiRole } from "./ai-config.ts";
import { GateError, readKey, type Gate } from "./ai-gate.ts";
import { archivistPrompt, readable } from "./ai-prompt.ts";
import { applyFindings, jsonOf, lastRun, parseFindings, undoRun } from "./archivist.ts";
import { applyProposals, parseProposals, pendingCount } from "./suggestions.ts";
import { imagesDir } from "./paths.ts";
import { cancelJobs, researcherHandler } from "./researcher.ts";

type Db = Database.Database;
export type Lane = 0 | 1 | 2;
type JobRow = { id: number; role: AiRole; object_id: string | null; turn_id?: number | null; lane: Lane; status: string; run_after: string; attempts: number; fails: number; created_at: string };
export type Outcome = "done" | "skip" | { busy: true } | { unusable: true } | { daily: true; resetAt?: number } | { key: true };
export type Handler = (job: JobRow, ctx: { gate: Gate; now: Date; countCall: () => void }) => Promise<Outcome>;

const iso = (d: Date) => d.toISOString();
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const nextMidnightUtc = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
/** After a busy answer: 1, 5, 15, 30 minutes, then every hour. `attempts` counts this one. */
export const retryDelayMinutes = (attempts: number) => AI_CONFIG.retryMinutes[Math.min(Math.max(attempts, 1), AI_CONFIG.retryMinutes.length) - 1];

export function createAi(db: Db, opts: { gate: Gate; now?: () => Date; hasKey?: () => boolean; handlers?: Partial<Record<AiRole, Handler>> }) {
  const now = opts.now ?? (() => new Date());
  const hasKey = opts.hasKey ?? (() => !!readKey());
  const meta = {
    get: (k: string) => (db.prepare("SELECT value FROM ai_meta WHERE key = ?").get(k) as any)?.value as string | undefined,
    set: (k: string, v: string) => db.prepare("INSERT INTO ai_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(k, v),
    del: (k: string) => db.prepare("DELETE FROM ai_meta WHERE key = ?").run(k),
  };
  // A job that was mid-call when the Mac went off or the Garden closed starts over.
  db.prepare("UPDATE ai_jobs SET status = 'waiting' WHERE status = 'working'").run();

  const used = (role: AiRole, at = now()) => ((db.prepare("SELECT calls FROM ai_usage WHERE day = ? AND role = ?").get(dayOf(at), role) as any)?.calls ?? 0) as number;
  const countCall = (role: AiRole) =>
    db.prepare("INSERT INTO ai_usage (day, role, calls) VALUES (?, ?, 1) ON CONFLICT (day, role) DO UPDATE SET calls = calls + 1").run(dayOf(now()), role);

  /** When the daily count starts again: what OpenRouter last told us, else its documented 00:00 UTC. */
  function nextReset(): { at: Date; source: string } {
    const learned = meta.get("reset_at");
    if (learned && Date.parse(learned) > now().getTime()) return { at: new Date(learned), source: meta.get("reset_source") ?? "OpenRouter" };
    return { at: nextMidnightUtc(now()), source: "00:00 UTC every day (OpenRouter's documented reset)" };
  }
  const learnReset = (ms: number | undefined) => {
    if (!ms || ms <= now().getTime()) return;
    meta.set("reset_at", new Date(ms).toISOString());
    meta.set("reset_source", "told by OpenRouter when the count ran out");
  };

  const insert = (role: AiRole, objectId: string | null, lane: Lane, runAfter: Date) => {
    const t = iso(now());
    return Number(db.prepare("INSERT INTO ai_jobs (role, object_id, lane, status, run_after, created_at, updated_at) VALUES (?, ?, ?, 'waiting', ?, ?, ?)").run(role, objectId, lane, iso(runAfter), t, t).lastInsertRowid);
  };
  const active = (id: string) => db.prepare("SELECT 1 FROM ai_jobs WHERE object_id = ? AND role = 'archivist' AND status IN ('waiting', 'working', 'busy', 'tomorrow')").get(id);

  const api = {
    /** Newly captured Objects: the Archivist looks at them in about 2 minutes (or sooner, when the Capture window closes). Private ones are never queued. */
    enqueueCaptured(ids: string[]) {
      for (const id of ids) if (readable(db, id) && !active(id)) insert("archivist", id, 2, addMin(now(), AI_CONFIG.captureWaitMinutes));
    },
    /** The owner asked (Retry, or "Ask the Archivist"). Goes ahead of captures. */
    request(id: string) {
      if (!readable(db, id)) return false;
      db.prepare("UPDATE ai_jobs SET status = 'cancelled' WHERE object_id = ? AND role = 'archivist' AND status IN ('waiting', 'busy', 'tomorrow', 'failed')").run(id);
      insert("archivist", id, 1, now());
      return true;
    },
    /** A job for any role. */
    enqueue: insert,
    /**
     * A Researcher question the owner is waiting on (lane 0: it goes ahead of everything the Archivist has waiting). It is
     * saved before this is called, so a busy AI or a closed Garden never loses it. The job belongs to one question ("turn").
     */
    askResearcher(turnId: number) {
      const jobId = insert("researcher", null, 0, now());
      db.prepare("UPDATE ai_jobs SET turn_id = ? WHERE id = ?").run(turnId, jobId);
      return jobId;
    },
    /** The Cancel button: the question stays saved, but nothing more is asked of the AI for it. */
    cancelQuestion: (turnId: number) => cancelJobs(db, turnId) > 0,
    /** The Capture window closed: stop waiting out the 2 minutes. */
    flushCaptures() {
      return db.prepare("UPDATE ai_jobs SET run_after = ? WHERE status = 'waiting' AND lane = 2 AND run_after > ?").run(iso(now()), iso(now())).changes;
    },
    undo: (id: string) => undoRun(db, id),

    /** What to show on one Object. */
    statusOf(id: string) {
      const o = db.prepare("SELECT private FROM objects WHERE id = ? AND deleted_at IS NULL").get(id) as any;
      if (!o) return null;
      const run = lastRun(db, id);
      if (o.private) return { state: "private" as const, run, canRun: false, pending: 0 };
      const pending = pendingCount(db, id);
      const j = db.prepare("SELECT * FROM ai_jobs WHERE object_id = ? AND role = 'archivist' AND status <> 'cancelled' ORDER BY id DESC LIMIT 1").get(id) as JobRow | undefined;
      if (!j) return { state: "none" as const, run, canRun: true, pending };
      const state = (j.status === "done" ? "done" : j.status) as "waiting" | "working" | "busy" | "tomorrow" | "failed" | "done";
      return { state, run, pending, canRun: state === "done" || state === "failed", nextTryAt: state === "busy" || state === "tomorrow" ? j.run_after : undefined, needsKey: state !== "done" && state !== "failed" && !hasKey() };
    },

    /** The quiet line in the top bar. */
    summary() {
      const t = now();
      const left = (role: AiRole) => Math.max(0, AI_CONFIG.dailyCalls[role] - used(role, t));
      const account = meta.get("account") ? JSON.parse(meta.get("account")!) : null;
      const mine = left("archivist") + left("researcher");
      const waiting = (db.prepare("SELECT count(*) AS n FROM ai_jobs WHERE status IN ('waiting', 'working', 'busy', 'tomorrow')").get() as any).n as number;
      const reset = nextReset();
      return {
        keySet: hasKey(),
        keyProblem: !!meta.get("key_problem"),
        left: account && account.day === dayOf(t) ? Math.min(mine, account.remaining) : mine,
        /** True when the day's calls are nearly gone (see AI_CONFIG.lowCallsWarning). */
        low: (account && account.day === dayOf(t) ? Math.min(mine, account.remaining) : mine) <= AI_CONFIG.lowCallsWarning,
        researcherLeft: Math.max(0, Math.min(left("researcher"), account && account.day === dayOf(t) ? account.remaining : Infinity)),
        waiting,
        budgets: { archivist: { used: used("archivist", t), limit: AI_CONFIG.dailyCalls.archivist }, researcher: { used: used("researcher", t), limit: AI_CONFIG.dailyCalls.researcher } },
        reset: { at: iso(reset.at), source: reset.source },
        models: AI_CONFIG.models,
      };
    },

    async refreshAccount() {
      if (!hasKey()) return;
      try {
        const a = await opts.gate.account();
        meta.set("account", JSON.stringify({ ...a, day: dayOf(now()) }));
        meta.del("key_problem");
        if (a.remaining <= 0) meta.set("blocked_day", dayOf(now()));
      } catch (e) {
        if (e instanceof GateError && e.kind === "key") meta.set("key_problem", "1");
      }
    },

    /** Do the next job that is due, if any. Returns whether it did one. */
    async tick(): Promise<boolean> {
      if (busy || !hasKey()) return false;
      const t = now();
      if (lastCall && t.getTime() - lastCall < AI_CONFIG.secondsBetweenCalls * 1000) return false;
      const due = db.prepare("SELECT * FROM ai_jobs WHERE status IN ('waiting', 'busy', 'tomorrow') AND run_after <= ? ORDER BY lane, created_at, id").all(iso(t)) as JobRow[];
      for (const job of due) {
        const handler = opts.handlers?.[job.role] ?? (job.role === "archivist" ? archivistHandler : researcherHandlerFor);
        if (!handler) continue;
        const blocked = meta.get("blocked_day") === dayOf(t);
        if (blocked || used(job.role, t) >= AI_CONFIG.dailyCalls[job.role]) {
          db.prepare("UPDATE ai_jobs SET status = 'tomorrow', run_after = ?, updated_at = ? WHERE id = ?").run(iso(nextReset().at), iso(t), job.id);
          continue;
        }
        // A saved link is read first; the Archivist waits for the words (up to 30 minutes).
        if (job.role === "archivist" && job.object_id && isReading(job.object_id) && t.getTime() - Date.parse(job.created_at) < 30 * 60_000) continue;
        busy = true;
        try {
          db.prepare("UPDATE ai_jobs SET status = 'working', updated_at = ? WHERE id = ?").run(iso(t), job.id);
          lastCall = t.getTime();
          let out: Outcome;
          try { out = await handler(job, { gate: opts.gate, now: t, countCall: () => countCall(job.role) }); }
          catch { out = { unusable: true }; } // whatever went wrong, the content is untouched and the step can be retried
          settle(job, out, t);
        } finally { busy = false; }
        return true;
      }
      return false;
    },

    start(everyMs = 5000) {
      timer = setInterval(() => void api.tick().catch(() => {}), everyMs);
      timer.unref();
      void api.refreshAccount();
      refresher = setInterval(() => void api.refreshAccount(), 10 * 60_000);
      refresher.unref();
    },
    stop() { if (timer) clearInterval(timer); if (refresher) clearInterval(refresher); },
  };
  let busy = false, lastCall = 0;
  let timer: ReturnType<typeof setInterval> | undefined, refresher: ReturnType<typeof setInterval> | undefined;

  const isReading = (id: string) => !!db.prepare("SELECT 1 FROM field_values WHERE object_id = ? AND field = 'extraction' AND value = 'reading'").get(id);

  const researcherHandlerFor: Handler = (job, ctx) => researcherHandler(db, job, ctx);

  function settle(job: JobRow, out: Outcome, t: Date) {
    const set = (status: string, runAfter: Date, extra: Record<string, number | string | null> = {}) =>
      db.prepare("UPDATE ai_jobs SET status = ?, run_after = ?, attempts = coalesce(?, attempts), fails = coalesce(?, fails), last_error = ?, updated_at = ? WHERE id = ? AND status <> 'cancelled'")
        .run(status, iso(runAfter), extra.attempts ?? null, extra.fails ?? null, (extra.error as string) ?? null, iso(t), job.id);
    if (out === "done") { set("done", t); meta.del("key_problem"); }
    else if (out === "skip") set("cancelled", t);
    else if ("busy" in out) {
      const n = job.attempts + 1;
      // A Researcher question is retried for about an hour (1, 5, 15, 30 minutes); then it stops and says so. The Archivist keeps trying hourly.
      if (job.role === "researcher" && n >= AI_CONFIG.researcherBusyTries) set("failed", t, { attempts: n, error: "busy for about an hour" });
      else set("busy", addMin(t, retryDelayMinutes(n)), { attempts: n }); // never a failure
    }
    else if ("daily" in out) { learnReset(out.resetAt); meta.set("blocked_day", dayOf(t)); set("tomorrow", nextReset().at); }
    else if ("key" in out) { meta.set("key_problem", "1"); set("waiting", addMin(t, 10)); }
    else { // answered, but nothing usable
      const n = job.fails + 1;
      if (n >= AI_CONFIG.maxUnusable) set("failed", t, { fails: n, error: "nothing usable came back" });
      else set("waiting", addMin(t, retryDelayMinutes(n)), { fails: n });
    }
  }

  async function archivistHandler(job: JobRow, ctx: { gate: Gate; now: Date; countCall: () => void }): Promise<Outcome> {
    const id = job.object_id!;
    const photo = db.prepare("SELECT file FROM source_images WHERE object_id = ?").get(id) as any;
    let image: { dataUrl: string } | undefined;
    if (photo) {
      try { image = { dataUrl: "data:image/jpeg;base64," + (await readFile(join(imagesDir(), photo.file))).toString("base64") }; } catch { return { unusable: true }; }
    }
    const prompt = archivistPrompt(db, id, image);
    if (!prompt) return "skip"; // Private, or in the Bin: the AI never reads it
    const models = photo ? AI_CONFIG.visionModels : AI_CONFIG.models; // photos wait for a model that can see them
    let sawBusy = false;
    for (const model of models) {
      let text: string;
      try { ctx.countCall(); text = await ctx.gate.chat(model, prompt.messages); }
      catch (e) {
        if (!(e instanceof GateError)) throw e;
        if (e.kind === "daily") return { daily: true, resetAt: e.resetAt };
        if (e.kind === "key" || e.kind === "missing") return { key: true };
        if (e.kind === "busy") sawBusy = true;
        continue; // busy or "bad": try the next model
      }
      const findings = parseFindings(text);
      if (!findings) continue;
      const runId = applyFindings(db, id, findings, model, ctx.now);
      applyProposals(db, id, parseProposals(jsonOf(text)), prompt.candidates, model, ctx.now, runId); // Connections (applied), Suggestions and the AI Note, from the same call
      return "done";
    }
    return sawBusy ? { busy: true } : { unusable: true };
  }
  return api;
}
export type Ai = ReturnType<typeof createAi>;
