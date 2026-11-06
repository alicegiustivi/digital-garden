import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../src/server/db.ts";

let s: ReturnType<typeof openDb>["sqlite"];
beforeEach(() => {
  s = openDb(":memory:").sqlite;
  s.prepare("INSERT INTO objects (id, type) VALUES ('a','source'), ('b','thought')").run();
  s.prepare("INSERT INTO tags (name) VALUES ('reading')").run();
});

const AI = ", 'ai', 'archivist', 'some-model:free', '2026-11-06'";

describe("Origin is required (ADR 0001)", () => {
  it("refuses a field value with no Origin", () => {
    expect(() => s.prepare("INSERT INTO field_values (object_id, field, value) VALUES ('a','title','x')").run()).toThrow(/NOT NULL/);
  });
  it("refuses a field value with an unknown Origin", () => {
    expect(() => s.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES ('a','title','x','me')").run()).toThrow(/CHECK/);
  });
  it("refuses a Tag on an Object with no Origin", () => {
    expect(() => s.prepare("INSERT INTO object_tags (object_id, tag_id) VALUES ('a',1)").run()).toThrow(/NOT NULL/);
  });
  it("refuses a Connection with no Origin", () => {
    expect(() => s.prepare("INSERT INTO connections (from_id, to_id) VALUES ('a','b')").run()).toThrow(/NOT NULL/);
  });
  it("refuses a block with no Origin", () => {
    expect(() => s.prepare("INSERT INTO blocks (object_id, position, text) VALUES ('a',0,'hi')").run()).toThrow(/NOT NULL/);
  });
  it("accepts each with an Origin", () => {
    for (const o of ["source", "owner"]) {
      s.prepare("DELETE FROM blocks").run();
      s.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES ('a',0,'hi',?)").run(o);
    }
    s.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES ('a','title','x','owner')").run();
    s.prepare("INSERT INTO object_tags (object_id, tag_id, origin) VALUES ('a',1,'owner')").run();
    s.prepare("INSERT INTO connections (from_id, to_id, origin) VALUES ('a','b','owner')").run();
  });
  it("AI pieces must also record role, model and date", () => {
    expect(() => s.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES ('a',0,'hi','ai')").run()).toThrow(/CHECK/);
    s.prepare(`INSERT INTO blocks (object_id, position, text, origin, ai_role, ai_model, ai_date) VALUES ('a',0,'hi'${AI})`).run();
  });
  it("refuses a second Connection between the same two Objects, either way round", () => {
    s.prepare("INSERT INTO connections (from_id, to_id, origin) VALUES ('a','b','owner')").run();
    expect(() => s.prepare("INSERT INTO connections (from_id, to_id, origin) VALUES ('b','a','owner')").run()).toThrow(/UNIQUE/);
  });
});

describe("search index (FTS5)", () => {
  const find = (q: string) => s.prepare("SELECT DISTINCT object_id FROM search_index WHERE search_index MATCH ?").all(q);
  it("finds a word saved in a block", () => {
    s.prepare("INSERT INTO blocks (object_id, position, text, origin) VALUES ('a',0,'Mycorrhizal networks are fascinating','owner')").run();
    expect(find("mycorrhizal")).toEqual([{ object_id: "a" }]);
    expect(find("zebra")).toEqual([]);
  });
  it("finds a word saved in a field and follows edits and deletes", () => {
    s.prepare("INSERT INTO field_values (object_id, field, value, origin) VALUES ('b','title','Lichen','owner')").run();
    expect(find("lichen")).toEqual([{ object_id: "b" }]);
    s.prepare("UPDATE field_values SET value='Moss' WHERE object_id='b'").run();
    expect(find("lichen")).toEqual([]);
    expect(find("moss")).toEqual([{ object_id: "b" }]);
    s.prepare("DELETE FROM field_values WHERE object_id='b'").run();
    expect(find("moss")).toEqual([]);
  });
});
