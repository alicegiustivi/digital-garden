import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync("src/web/style.css", "utf8");
const rule = (sel: string) => css.split("}").find((r) => r.trim().startsWith(sel)) ?? "";
const main = readFileSync("src/web/main.tsx", "utf8");

describe("the Issue look", () => {
  it("uses the Espresso colours in dark mode", () => {
    const dark = css.slice(css.indexOf(':root[data-scheme="dark"]'));
    for (const hex of ["#191613", "#1f1b17", "#26221d", "#2c2722", "#352f29", "#ede6db", "#a59c90", "#8c8376"]) expect(dark).toContain(hex);
    for (const hex of ["#72b2cb", "#ab96e2", "#dcae5c", "#e6907c"]) expect(dark).toContain(hex);
  });
  it("Origin marks use glyphs, lines and italics, never colour", () => {
    for (const sel of [".o-ai", ".o-ai::after", ".o-src", ".o-src::before"]) {
      expect(rule(sel), sel).not.toMatch(/(^|[^-])color\s*:\s*(?!color-mix\(in srgb, currentColor)|background/);
    }
    expect(css).toContain('content: "✦"');
    expect(css).toContain('content: "❝"');
  });
  it("Origin marks are written once, so light and dark look the same", () => {
    expect(css.match(/\.o-ai\b/g)!.length).toBeLessThanOrEqual(3);
    const dark = css.slice(css.indexOf(':root[data-scheme="dark"]'));
    expect(dark.slice(0, dark.indexOf("}"))).not.toMatch(/\.o-(ai|src)/);
  });
  it("SF Pro is the only text typeface (code may use the system monospace)", () => {
    const families = [...css.matchAll(/font-family:\s*([^;]+);|--sf:\s*([^;]+);/g)].map((m) => m[1] ?? m[2]);
    expect(families.length).toBeGreaterThan(0);
    for (const f of families) expect(f).toMatch(/SF Pro|var\(--sf\)|inherit|^ui-monospace, "SF Mono", Menlo, monospace$/);
    expect(css).not.toMatch(/Playfair|Fraunces|Georgia|Newsreader|Bricolage/);
  });
  it("the drop cap takes the type's colour", () => {
    expect(css).toMatch(/first-letter[^}]*color: var\(--c\)/);
  });
  it("the top bar has the listed pages and More, and no sidebar", () => {
    for (const label of ["This week", "Sources", "Concepts", "Thoughts", "People", "Tags", "More"]) expect(main).toContain(label);
    expect(main).not.toMatch(/sidebar/i);
    expect(main).toContain("Dark (Espresso)");
    expect(main).toContain("Same as Mac");
  });
});
