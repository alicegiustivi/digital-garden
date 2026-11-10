import { describe, it, expect } from "vitest";
import { toDoc, fromDoc, plainOf, type DocNode } from "../src/shared/markdown-doc.ts";

const ID = "0b9c1d52-3c1e-4c53-9a77-5a1f3f2d9e10";
const trip = (md: string) => fromDoc(toDoc([md]));
const text = (s: string, marks: any[] = []): DocNode => ({ type: "text", text: s, ...(marks.length ? { marks } : {}) });
const para = (...c: DocNode[]): DocNode => ({ type: "paragraph", content: c });

describe("words written before Markdown stay exactly as they were", () => {
  for (const s of ["Walking helps me think.", "5 * 3 = 15", "a snake_case word and file_name.txt", "Costs $5 - or 6 + 1", "Price: 10% (maybe) [note] #tag", "C:\\path\\to", "Un testo in italiano, con accenti: è così."]) {
    it(JSON.stringify(s), () => expect(trip(s)).toEqual([s]));
  }
  it("keeps a Mention in a sentence", () => expect(trip(`see [[o:${ID}]] for more`)).toEqual([`see [[o:${ID}]] for more`]));
});

describe("Markdown round-trips through the editor's document", () => {
  const samples = [
    "# A title", "## A smaller one", "### Smaller still",
    "**bold** and *italic* and ~~gone~~ and `code`",
    "***both***",
    "a [link](https://example.com/a_b) here",
    "- one\n- two\n  - nested",
    "1. first\n2. second",
    "> a quoted thought",
    "```js\nconst a = 1;\n```",
    "---",
    `- see [[o:${ID}]]\n- and **bold** [[o:${ID}]]`,
    "line one\\\nline two",
  ];
  for (const md of samples) it(JSON.stringify(md), () => expect(trip(md)).toEqual([md]));

  it("turns typed marks into the editor's marks", () => {
    const [p] = toDoc(["a **b** `c`"]).content!;
    expect(p.content).toEqual([text("a "), text("b", [{ type: "bold" }]), text(" "), text("c", [{ type: "code" }])]);
  });
  it("reads a heading and a list as blocks", () => {
    const doc = toDoc(["## Title", "- a\n- b"]);
    expect(doc.content!.map((n) => n.type)).toEqual(["heading", "bulletList"]);
    expect(doc.content![0].attrs).toEqual({ level: 2 });
    expect(doc.content![1].content).toHaveLength(2);
  });
  it("reads an empty list of blocks as one empty paragraph", () => expect(toDoc([]).content).toEqual([{ type: "paragraph" }]));
});

describe("literal text that looks like Markdown is protected, not turned into formatting", () => {
  const lit = (s: string) => fromDoc({ type: "doc", content: [para(text(s))] })[0];
  it("stars, backticks and a leading #", () => {
    expect(lit("*star*")).toBe("\\*star\\*");
    expect(lit("use `x`")).toBe("use \\`x\\`");
    expect(lit("# not a heading")).toBe("\\# not a heading");
    expect(lit("- not a list")).toBe("\\- not a list");
    expect(lit("1. not a list")).toBe("1\\. not a list");
  });
  it("and reads back as the same words", () => {
    for (const s of ["*star*", "use `x`", "# not a heading", "- not a list", "1. not a list", "_under_", "[a](b) typed", "~~x~~"]) {
      const back = toDoc([lit(s)]).content![0];
      expect(back.type).toBe("paragraph");
      expect(back.content!.map((c) => c.text).join("")).toBe(s);
      expect(back.content!.every((c) => !c.marks)).toBe(true);
    }
  });
  it("keeps spaces outside a mark", () => {
    expect(fromDoc({ type: "doc", content: [para(text("a "), text("b ", [{ type: "bold" }]), text("c"))] })[0]).toBe("a **b** c");
  });
});

describe("plainOf", () => {
  it("strips the formatting for a one-line view", () => {
    expect(plainOf("## A **bold** [link](https://x.y) `code`")).toBe("A bold link code");
    expect(plainOf("- one\n- two")).toBe("one two");
    expect(plainOf("> quote\\\nbreak")).toBe("quote break");
    expect(plainOf("plain words, 5 * 3")).toBe("plain words, 5 * 3");
  });
});
