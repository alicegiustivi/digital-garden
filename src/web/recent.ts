// The Objects the owner opened lately, kept on this Mac only, for ⌘K.
const KEY = "garden.recent";
export function recentIds(): string[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
export function addRecent(id: string) {
  try { localStorage.setItem(KEY, JSON.stringify([id, ...recentIds().filter((x) => x !== id)].slice(0, 12))); } catch { /* fine */ }
}
