import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { PALETTE, TYPE_ICONS, CORE_TYPES, DEFAULT_COLOUR, typeColourCss } from "../src/shared/palette.ts";

// WCAG 2.x contrast. The surfaces are the ones in style.css (light: white, --wash; dark: Espresso ground, sheet, card, wash).
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (h: string) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const css = readFileSync("src/web/style.css", "utf8");
const surface = (name: string, scheme: "light" | "dark") => {
  const block = scheme === "dark" ? css.slice(css.indexOf(':root[data-scheme="dark"]')) : css;
  return block.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))![1];
};

describe("the type colour palette (issue #107)", () => {
  it("has eighteen soft colours, each with its own name, fill and ink", () => {
    expect(PALETTE).toHaveLength(18);
    for (const f of ["key", "label", "fill", "ink", "text", "darkFill", "darkInk"] as const) expect(new Set(PALETTE.map((c) => c[f])).size, f).toBe(18);
  });
  for (const c of PALETTE) {
    it(`${c.label}: the text shade reads as text (4.5:1) on every surface and on its own fill, the ink shows as an outline (3:1), in light and dark`, () => {
      const lightSurfaces = ["#ffffff", surface("sheet", "light"), surface("wash", "light"), c.fill];
      const darkSurfaces = [surface("ground", "dark"), surface("sheet", "dark"), surface("card", "dark"), surface("wash", "dark"), c.darkFill];
      for (const s of lightSurfaces) expect(ratio(c.text, s), `${c.key} text on ${s}`).toBeGreaterThanOrEqual(4.5);
      for (const s of darkSurfaces) expect(ratio(c.darkInk, s), `${c.key} dark on ${s}`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(c.ink, "#ffffff")).toBeGreaterThanOrEqual(3);
      expect(ratio(c.darkInk, surface("card", "dark"))).toBeGreaterThanOrEqual(3);
    });
  }
  it("the four core types start on a palette colour", () => {
    for (const t of CORE_TYPES) expect(PALETTE.map((c) => c.key)).toContain(DEFAULT_COLOUR[t]);
  });
  it("writes one ink and one fill per type, light and dark, from the data", () => {
    const out = typeColourCss([{ key: "x-book", color: "teal" }, { key: "source", color: "ocean" }]);
    expect(out).toContain("--t-x-book:#10a392;--tt-x-book:#10786c;--tf-x-book:#ccfbf1");
    expect(out).toContain("--t-x-book:#5eead4");
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
