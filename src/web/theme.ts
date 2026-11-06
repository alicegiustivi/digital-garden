// Appearance: Light, Dark (Espresso) or Same as Mac. Same as Mac follows the Mac live.
export type Appearance = "light" | "dark" | "system";
const KEY = "garden.appearance";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getAppearance(): Appearance {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {}
  return "system";
}

export function applyAppearance(a: Appearance) {
  const dark = a === "dark" || (a === "system" && media.matches);
  document.documentElement.dataset.scheme = dark ? "dark" : "light";
}

export function setAppearance(a: Appearance) {
  try { localStorage.setItem(KEY, a); } catch {}
  applyAppearance(a);
}

export function startFollowingMac() {
  applyAppearance(getAppearance());
  media.addEventListener("change", () => applyAppearance(getAppearance()));
}
