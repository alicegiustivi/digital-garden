// The twelve colours an Object Type can have (issue #107, ADR 0008). Each has a hand-tuned light and dark pair.
// They are bright, spread around the colour wheel, and kept apart from the Tag colours (--g-* in style.css) so a type never looks like a Tag. A type stores only the
// colour's key, so a colour can be re-tuned here without touching the database. tests/palette.test.ts fails if any pair
// stops being readable: the colour as text must reach WCAG AA (4.5:1) on every surface it sits on, and as a fill or
// outline it must reach 3:1 (WCAG 1.4.11).
export type PaletteColour = { key: string; label: string; light: string; dark: string };

export const PALETTE: PaletteColour[] = [
  { key: "ocean", label: "Ocean", light: "#0369a1", dark: "#38bdf8" }, // Source
  { key: "violet", label: "Violet", light: "#7c3aed", dark: "#ab8ffa" }, // Concept
  { key: "gold", label: "Gold", light: "#9a5c06", dark: "#fbbf24" }, // Thought
  { key: "coral", label: "Red", light: "#cc2222", dark: "#f87a7a" }, // Person
  { key: "green", label: "Green", light: "#15793a", dark: "#4ade80" },
  { key: "rose", label: "Pink", light: "#c3216b", dark: "#f475b7" },
  { key: "indigo", label: "Indigo", light: "#4338ca", dark: "#909af8" },
  { key: "teal", label: "Teal", light: "#0f766e", dark: "#2dd4bf" },
  { key: "lime", label: "Lime", light: "#49760f", dark: "#a3e635" },
  { key: "orange", label: "Orange", light: "#ba3f0c", dark: "#fb923c" },
  { key: "fuchsia", label: "Magenta", light: "#a21caf", dark: "#e879f9" },
  { key: "leaf", label: "Leaf", light: "#2f7a1b", dark: "#7ce05a" },
];
export const COLOUR_KEYS = PALETTE.map((c) => c.key);
export const isColour = (k: unknown): k is string => typeof k === "string" && COLOUR_KEYS.includes(k);

/** The icons an owner-made type can pick: Hugeicons "stroke rounded" (MIT), a small set kept in src/web/icons.ts. */
export const TYPE_ICONS: { key: string; label: string }[] = [
  { key: "book", label: "Book" }, { key: "place", label: "Place" }, { key: "folder", label: "Project" }, { key: "recipe", label: "Recipe" },
  { key: "film", label: "Film" }, { key: "music", label: "Music" }, { key: "idea", label: "Idea" }, { key: "tool", label: "Tool" },
  { key: "home", label: "Home" }, { key: "travel", label: "Travel" }, { key: "camera", label: "Photo" }, { key: "shop", label: "Shopping" },
  { key: "calendar", label: "Event" }, { key: "work", label: "Work" }, { key: "game", label: "Game" }, { key: "mic", label: "Talk" },
  { key: "car", label: "Car" }, { key: "art", label: "Art" }, { key: "coffee", label: "Drink" }, { key: "health", label: "Health" },
  { key: "globe", label: "Web" }, { key: "star", label: "Favourite" }, { key: "gift", label: "Gift" }, { key: "learn", label: "Course" },
  { key: "box", label: "Thing" }, { key: "code", label: "Code" }, { key: "puzzle", label: "Puzzle" }, { key: "tree", label: "Nature" },
];
export const ICON_KEYS = TYPE_ICONS.map((i) => i.key);
export const isTypeIcon = (k: unknown): k is string => typeof k === "string" && ICON_KEYS.includes(k);

/** The four Core Object Types and the colour each had before the owner could choose (CONTEXT.md: Object Type). */
export const CORE_TYPES = ["source", "concept", "thought", "person"] as const;
export const isCoreType = (key: string) => (CORE_TYPES as readonly string[]).includes(key);
export const DEFAULT_COLOUR: Record<string, string> = { source: "ocean", concept: "violet", thought: "gold", person: "coral" };

/** The CSS the screen needs so `var(--t-<key>)` is each type's colour, light and dark. Types only ever come from the database, and keys and colours are checked on the way in. */
export function typeColourCss(types: { key: string; color: string }[]): string {
  const find = (k: string) => PALETTE.find((c) => c.key === k) ?? PALETTE[0];
  const light = types.map((t) => `--t-${t.key}:${find(t.color).light}`).join(";");
  const dark = types.map((t) => `--t-${t.key}:${find(t.color).dark}`).join(";");
  return `:root{${light}}:root[data-scheme="dark"]{${dark}}`;
}
