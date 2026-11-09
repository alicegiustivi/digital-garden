// The one place that says which AI models are used and how much of them. Change a model here and nowhere else.
// Only models whose name ends in ":free" are ever called (the gate refuses anything else), so this costs $0.
export const AI_CONFIG = {
  /** Tried in this order. The first can look at photos; the second reads text only. */
  models: ["nvidia/nemotron-3.5-super-vl:free", "nvidia/nemotron-3-ultra-550b-a55b:free"],
  /** Models able to look at a photo. Photos wait for these. */
  visionModels: ["nvidia/nemotron-3.5-super-vl:free"],
  /** Calls per UTC day for each role (OpenRouter's free allowance is 1,000 a day once credits have been bought). */
  dailyCalls: { archivist: 300, researcher: 700 },
  /** Minutes to wait after a busy answer: 1, 5, 15, 30, then every hour. */
  retryMinutes: [1, 5, 15, 30, 60],
  /** How long the Archivist waits after a capture, in case more is coming. */
  captureWaitMinutes: 2,
  /** OpenRouter's free models allow 20 calls a minute; stay well under. */
  secondsBetweenCalls: 6,
  /** A Researcher question that meets a busy AI is retried after 1, 5, 15 and 30 minutes (about an hour), then it stops and says so. */
  researcherBusyTries: 5,
  /**
   * Warn when this few calls are left in a day. The limit is 1,000 (not 50), so the warning waits until 10% is left:
   * with 100 left that is still about 50 questions (each takes two calls), enough to see it coming and not nag before.
   */
  lowCallsWarning: 100,
  /** The most Connections the Archivist adds to one Object in one go (issue #66). Applied directly, marked and undoable. */
  maxConnections: 10,
  /** A model that answers but gives nothing usable is tried this many times before "Couldn't read this". */
  maxUnusable: 3,
};
export type AiRole = "archivist" | "researcher";
