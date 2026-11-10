// THE WEB GATE (issue #108, ADR 0009). The only file in the Garden that asks a website for a fact, apart from the AI gate (ai-gate.ts)
// and reading a link the owner captured (extract.ts). It speaks only to the sites listed below, over https, with a plain GET whose
// only owner-supplied part is one name (the title of one Object). It sends no cookie, no key and no account, and never a body.
export type WebFail = "offline" | "slow" | "limit" | "bad" | "refused";
export class WebError extends Error {
  constructor(public kind: WebFail, public site: string, message: string) { super(message); }
}

/** Every site the Garden may ask, by address, with the name the owner sees. Adding one means changing this list and ADR 0009. */
export const SITES: Record<string, string> = {
  "www.wikidata.org": "Wikidata",
  "en.wikipedia.org": "Wikipedia",
  "openlibrary.org": "Open Library",
};
export const siteOf = (url: string) => SITES[new URL(url).hostname] ?? new URL(url).hostname;

const TIMEOUT_MS = 10_000;
// Wikimedia asks every program to say what it is. It names the app only: no name, no address, nothing about the owner.
const USER_AGENT = "DigitalGarden/1.0 (a personal notes app running on one Mac)";

export function createWebGate(deps: { fetch?: typeof fetch } = {}) {
  const doFetch = deps.fetch ?? fetch;
  return {
    /** One GET. Returns the JSON, or null when the site says there is nothing there (404). */
    async getJson(url: string): Promise<any | null> {
      const u = new URL(url);
      const site = SITES[u.hostname];
      if (u.protocol !== "https:" || !site) throw new WebError("refused", u.hostname, `Refused: ${u.hostname} is not a site the Garden looks things up on.`);
      let res: Response;
      try {
        res = await doFetch(u.toString(), { method: "GET", headers: { accept: "application/json", "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error", credentials: "omit" } as RequestInit);
      } catch (e: any) {
        if (e?.name === "TimeoutError" || e?.name === "AbortError") throw new WebError("slow", site, `${site} took too long to answer.`);
        throw new WebError("offline", site, `Could not reach ${site}.`);
      }
      if (res.status === 404) return null;
      if (res.status === 429) throw new WebError("limit", site, `${site} asked for fewer requests.`);
      if (res.status >= 500 || res.status === 408) throw new WebError("slow", site, `${site} is not answering right now.`);
      if (!res.ok) throw new WebError("bad", site, `${site} refused the request.`);
      try { return await res.json(); } catch { throw new WebError("bad", site, `${site} sent back something unreadable.`); }
    },
  };
}
export type WebGate = ReturnType<typeof createWebGate>;

/** Plain words for a failure, as the owner reads them. Nothing was changed. */
export function failWords(e: WebError): string {
  switch (e.kind) {
    case "offline": return `Couldn’t reach ${e.site}. Are you online? Nothing was changed.`;
    case "slow": return `${e.site} didn’t answer in time. Try again in a minute. Nothing was changed.`;
    case "limit": return `${e.site} asked for fewer requests. Wait a few minutes and try again. Nothing was changed.`;
    default: return `${e.site} didn’t give a usable answer. Nothing was changed.`;
  }
}
