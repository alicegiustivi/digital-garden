import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE, TYPE_ICONS, CORE_TYPES, DEFAULT_COLOUR, typeColourCss } from "../src/shared/palette.ts";

// WCAG 2.x contrast. The surfaces are the ones in style.css (light: white, --wash; dark: Espresso ground, sheet, card, wash).
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a: string, b: string, pa: number) => "#" + rgb(a).map((v, i) => Math.round(v * pa + rgb(b)[i] * (1 - pa)).toString(16).padStart(2, "0")).join("");
const css = readFileSync("src/web/style.css", "utf8");
const surface = (name: string, scheme: "light" | "dark") => {
  const block = scheme === "dark" ? css.slice(css.indexOf(':root[data-scheme="dark"]')) : css;
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))![1];
};

describe("the type colour palette (issue #107)", () => {
  it("has about a dozen colours, each with its own name and its own pair", () => {
    expect(PALETTE).toHaveLength(12);
    expect(new Set(PALETTE.map((c) => c.key)).size).toBe(12);
    expect(new Set(PALETTE.map((c) => c.light)).size).toBe(12);
    expect(new Set(PALETTE.map((c) => c.dark)).size).toBe(12);
  });
  it("spreads around the colour wheel: no two colours within 15 degrees of hue", () => {
    const hue = (h: string) => { const [r, g, b] = rgb(h).map((v) => v / 255); const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; const x = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return ((x * 60) + 360) % 360; };
    const hs = PALETTE.map((c) => hue(c.light)).sort((a, b) => a - b);
    for (let i = 1; i < hs.length; i++) expect(hs[i] - hs[i - 1], `${hs[i - 1]} / ${hs[i]}`).toBeGreaterThanOrEqual(15);
  });
  for (const c of PALETTE) {
    it(`${c.label}: readable as text (4.5:1) on every surface, and as a fill or outline (3:1), in light and dark`, () => {
      const lightSurfaces = ["#ffffff", surface("sheet", "light"), surface("wash", "light"), mix(c.light, "#ffffff", 0.11)]; // the last is the type chip's tint
      const darkSurfaces = [surface("ground", "dark"), surface("sheet", "dark"), surface("card", "dark"), surface("wash", "dark"), mix(c.dark, surface("card", "dark"), 0.16)];
      for (const s of lightSurfaces) expect(ratio(c.light, s), `${c.key} light on ${s}`).toBeGreaterThanOrEqual(4.5);
      for (const s of darkSurfaces) expect(ratio(c.dark, s), `${c.key} dark on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.light, "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(ratio(c.dark, surface("card", "dark"))).toBeGreaterThanOrEqual(3);
    });
  }
  it("the four core types start on a palette colour", () => {
    for (const t of CORE_TYPES) expect(PALETTE.map((c) => c.key)).toContain(DEFAULT_COLOUR[t]);
  });
  it("the four core types start on these colours (brighter since the owner asked, issue #107)", () => {
    const dark = Object.fromEntries(PALETTE.map((c) => [c.key, c.dark]));
    expect([dark.ocean, dark.violet, dark.gold, dark.coral]).toEqual(["#38bdf8", "#ab8ffa", "#fbbf24", "#f87a7a"]);
  });
  it("writes one --t-<key> per type, light and dark, from the data", () => {
    const out = typeColourCss([{ key: "x-book", color: "teal" }, { key: "source", color: "ocean" }]);
    expect(out).toContain("--t-x-book:#0f766e");
    expect(out).toContain('--t-x-book:#2dd4bf');
    expect(out).toContain(':root[data-scheme="dark"]{');
  });
  it("offers only the icons kept in icons.ts, which are the Hugeicons stroke-rounded family", () => {
    const icons = readFileSync("src/web/icons.ts", "utf8");
    expect(icons).toMatch(/Hugeicons "stroke rounded" \(MIT licence/);
    for (const i of TYPE_ICONS) expect(icons, i.key).toMatch(new RegExp(`^\\s+${i.key}: "<`, "m"));
    expect(TYPE_ICONS.length).toBeGreaterThanOrEqual(20);
    expect(TYPE_ICONS.length).toBeLessThanOrEqual(30);
  });
});
