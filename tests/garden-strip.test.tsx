// @vitest-environment jsdom
// The "From your Garden" strip is always on the page (issue #154): placeholder when empty, a way back when hidden.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let reply: { items: any[] } = { items: [] };
vi.mock("../src/web/api", () => ({ api: { garden: () => Promise.resolve(reply), dismissGarden: () => Promise.resolve() } }));
const { GardenStrip, GARDEN_STRIP_EMPTY } = await import("../src/web/Garden.tsx");

async function draw(wide = false) {
  const el = document.createElement("div");
  document.body.append(el);
  await act(async () => { createRoot(el).render(<GardenStrip wide={wide} version={0} onOpen={() => {}} />); });
  return el;
}
const click = async (el: Element | null | undefined) => { await act(async () => { (el as HTMLElement).click(); }); };
const button = (el: Element, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => { document.body.innerHTML = ""; localStorage.clear(); reply = { items: [] }; });

describe("From your Garden strip", () => {
  it("is shown with a quiet placeholder when nothing is old enough yet", async () => {
    const el = await draw();
    expect(el.querySelector(".garden-strip")).not.toBeNull();
    expect(el.textContent).toContain("From your Garden");
    expect(el.textContent).toContain(GARDEN_STRIP_EMPTY);
    expect(el.querySelectorAll("li")).toHaveLength(0);
  });
  it("shows its items as before and can be dismissed down to the 'all for today' line", async () => {
    reply = { items: [{ id: "a", type: "thought", title: "Old idea", reason: "a year ago today", private: false }] };
    const el = await draw();
    expect(el.textContent).toContain("Old idea");
    expect(el.textContent).not.toContain(GARDEN_STRIP_EMPTY);
    await click(el.querySelector("button.x"));
    expect(el.textContent).toContain("That’s all for today");
  });
  it("can be hidden for today and brought back with Show", async () => {
    const el = await draw(true);
    expect(el.querySelector(".garden-strip.wide")).not.toBeNull();
    await click(button(el, "Hide for today"));
    expect(el.querySelector(".garden-strip.folded")).not.toBeNull();
    expect(el.textContent).not.toContain(GARDEN_STRIP_EMPTY);
    await click(button(el, "Show"));
    expect(el.textContent).toContain(GARDEN_STRIP_EMPTY);
    expect(localStorage.getItem("garden-strip-hidden")).toBeNull();
  });
});
