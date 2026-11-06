// Turning pasted links into one canonical form, so the same page is never saved twice.
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref_src)$/i;

export const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

export function canonicalLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim().replace(/[.,;:!?)\]]+$/, ""));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    let s = u.toString();
    if (u.pathname === "/" && !u.search) s = s.replace(/\/$/, "");
    else if (u.pathname.length > 1) s = s.replace(/\/(\?|$)/, "$1");
    return s;
  } catch { return null; }
}
