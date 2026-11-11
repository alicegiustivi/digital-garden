// The colours an Object Type can have (issue #107, ADR 0008): eighteen soft colours, chosen by the owner, in the Tailwind
// "100" tints. Each has the owner's pastel FILL (chips, covers, swatches), the colour's own INK (icons, dots and outlines, just
// deep enough to be seen) and a TEXT shade (the ink, only as much darker as text needs), with a matching pair for dark mode. A type stores only the colour's key, so a colour can be re-tuned
// here without touching the database. They are kept apart from the Tag colours (--g-* in style.css) so a type never looks
// like a Tag. tests/palette.test.ts fails if any text shade stops being readable (WCAG AA, 4.5:1) on the surfaces it sits on,
// its own fill included, or any ink stops being visible as an outline (3:1), in light and dark. The keys of the first four are kept from the first palette so nothing stored changes.
export type PaletteColour = { key: string; label: string; fill: string; ink: string; text: string; darkFill: string; darkInk: string };

export const PALETTE: PaletteColour[] = [
{ key: "grey", label: "Grey", fill: "#f1f1f0", ink: "#78716c", text: "#716b66", darkFill: "#36322d", darkInk: "#d6d3d1" },
  { key: "rose", label: "Rose", fill: "#ffe4e6", ink: "#f43f5e", text: "#c0304a", darkFill: "#4f282a", darkInk: "#fda4af" },
  { key: "pink", label: "Pink", fill: "#fce7f3", ink: "#ec4899", text: "#b93878", darkFill: "#4e2a36", darkInk: "#f9a8d4" },
  { key: "fuchsia", label: "Magenta", fill: "#fae8ff", ink: "#d946ef", text: "#aa36bb", darkFill: "#4a2947", darkInk: "#f0abfc" },
  { key: "purple", label: "Purple", fill: "#f3e8ff", ink: "#a855f7", text: "#8846c8", darkFill: "#402c49", darkInk: "#d8b4fe" },
  { key: "violet", label: "Violet", fill: "#ede9fe", ink: "#8b5cf6", text: "#774fd3", darkFill: "#3a2e48", darkInk: "#c4b5fd" },
  { key: "indigo", label: "Indigo", fill: "#e0e7ff", ink: "#6366f1", text: "#5457cf", darkFill: "#323047", darkInk: "#a5b4fc" },
  { key: "blue", label: "Blue", fill: "#dbeafe", ink: "#3b82f6", text: "#2d63bb", darkFill: "#2a3548", darkInk: "#93c5fd" },
  { key: "ocean", label: "Sky", fill: "#e0f2fe", ink: "#0e9bdb", text: "#0e72a2", darkFill: "#213c46", darkInk: "#7dd3fc" },
  { key: "cyan", label: "Cyan", fill: "#cffafe", ink: "#069db6", text: "#06778b", darkFill: "#204042", darkInk: "#67e8f9" },
  { key: "teal", label: "Teal", fill: "#ccfbf1", ink: "#10a392", text: "#10786c", darkFill: "#224038", darkInk: "#5eead4" },
  { key: "mint", label: "Mint", fill: "#d1fae5", ink: "#10a471", text: "#107953", darkFill: "#224031", darkInk: "#6ee7b7" },
  { key: "green", label: "Green", fill: "#dcfce7", ink: "#1ca44e", text: "#137d3c", darkFill: "#25432a", darkInk: "#86efac" },
  { key: "lime", label: "Lime", fill: "#ecfccb", ink: "#68a010", text: "#4f7a10", darkFill: "#39441c", darkInk: "#bef264" },
  { key: "yellow", label: "Yellow", fill: "#fef9c3", ink: "#b28908", text: "#886808", darkFill: "#4d3f19", darkInk: "#fde047" },
  { key: "gold", label: "Amber", fill: "#fef3c7", ink: "#c6800b", text: "#96620b", darkFill: "#4f3b19", darkInk: "#fcd34d" },
  { key: "orange", label: "Orange", fill: "#ffedd5", ink: "#eb6d14", text: "#ad5010", darkFill: "#50321c", darkInk: "#fdba74" },
  { key: "coral", label: "Red", fill: "#fee2e2", ink: "#ef4444", text: "#bb3434", darkFill: "#4e2925", darkInk: "#fca5a5" },
];
export const COLOUR_KEYS = PALETTE.map((c) => c.key);
export const isColour = (k: unknown): k is string => typeof k === "string" && COLOUR_KEYS.includes(k);

/** The icons an owner-made type can pick: Hugeicons "stroke rounded" (MIT), a set kept in src/web/icons.ts. */
export const TYPE_ICONS: { key: string; label: string }[] = [
  { key: "book", label: "Book" }, { key: "place", label: "Place" }, { key: "folder", label: "Project" }, { key: "recipe", label: "Recipe" },
  { key: "film", label: "Film" }, { key: "music", label: "Music" }, { key: "idea", label: "Idea" }, { key: "tool", label: "Tool" },
  { key: "home", label: "Home" }, { key: "travel", label: "Travel" }, { key: "camera", label: "Photo" }, { key: "shop", label: "Shopping" },
  { key: "calendar", label: "Event" }, { key: "work", label: "Work" }, { key: "game", label: "Game" }, { key: "mic", label: "Talk" },
  { key: "car", label: "Car" }, { key: "art", label: "Art" }, { key: "coffee", label: "Drink" }, { key: "health", label: "Health" },
  { key: "globe", label: "Web" }, { key: "star", label: "Favourite" }, { key: "gift", label: "Gift" }, { key: "learn", label: "Course" },
  { key: "box", label: "Thing" }, { key: "code", label: "Code" }, { key: "puzzle", label: "Puzzle" }, { key: "tree", label: "Nature" },
  { key: "pen", label: "Writing" }, { key: "notebook", label: "Journal" }, { key: "news", label: "Article" }, { key: "listen", label: "Listen" },
  { key: "heart", label: "Heart" }, { key: "mind", label: "Mind" }, { key: "fitness", label: "Fitness" }, { key: "bike", label: "Bike" },
  { key: "money", label: "Money" }, { key: "building", label: "Building" }, { key: "pet", label: "Pet" }, { key: "flower", label: "Flower" },
  { key: "language", label: "Language" }, { key: "explore", label: "Explore" }, { key: "mountain", label: "Mountain" }, { key: "sunny", label: "Sun" },
  { key: "laptop", label: "Computer" }, { key: "mail", label: "Letter" }, { key: "science", label: "Science" }, { key: "guitar", label: "Instrument" },
  { key: "rocket", label: "Launch" },
];
export const ICON_KEYS = TYPE_ICONS.map((i) => i.key);
export const isTypeIcon = (k: unknown): k is string => typeof k === "string" && ICON_KEYS.includes(k);

/** The six Core Object Types and the colour each starts with (CONTEXT.md: Object Type). Project and Piece are the Express types (issue #139). */
export const CORE_TYPES = ["source", "concept", "thought", "person", "project", "piece"] as const;
export const isCoreType = (key: string) => (CORE_TYPES as readonly string[]).includes(key);
export const DEFAULT_COLOUR: Record<string, string> = { source: "ocean", concept: "violet", thought: "gold", person: "coral", project: "green", piece: "orange" };

/** A Piece and a Project are the owner's own work: the Archivist never reads, tags, connects or fills them, and never offers one as a Connection candidate (CONTEXT.md: Piece, Project). */
export const ARCHIVIST_NEVER = ["thought", "piece", "project"] as const;
export const archivistNever = (type: string) => (ARCHIVIST_NEVER as readonly string[]).includes(type);
/** The Stages the owner can set, per type, and the field that holds each. Stage is only ever set by the owner and carries no date. */
export const STAGES: Record<string, { field: string; stages: string[]; first: string; /** the order a list shows them in; Finished is last and folded away */ listOrder: string[] }> = {
  project: { field: "stage-project", stages: ["Active", "Paused", "Finished"], first: "Active", listOrder: ["Active", "Paused", "Finished"] },
  piece: { field: "stage-piece", stages: ["Idea", "Drafting", "Finished"], first: "Idea", listOrder: ["Drafting", "Idea", "Finished"] },
};
export const STAGE_FIELDS = Object.values(STAGES).map((s) => s.field);

/** The CSS the screen needs so `var(--t-<key>)` is each type's ink and `var(--tf-<key>)` its fill, light and dark. Types only ever come from the database, and keys and colours are checked on the way in. */
export function typeColourCss(types: { key: string; color: string }[]): string {
  const find = (k: string) => PALETTE.find((c) => c.key === k) ?? PALETTE[0];
  const light = types.map((t) => `--t-${t.key}:${find(t.color).ink};--tt-${t.key}:${find(t.color).text};--tf-${t.key}:${find(t.color).fill}`).join(";");
  const dark = types.map((t) => `--t-${t.key}:${find(t.color).darkInk};--tt-${t.key}:${find(t.color).darkInk};--tf-${t.key}:${find(t.color).darkFill}`).join(";");
  return `:root{${light}}:root[data-scheme="dark"]{${dark}}`;
}
