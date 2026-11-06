// Drizzle's description of the tables in migrations/0001_init.sql.
// The SQL file is the source of truth (it holds the Origin rules and the search index).
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";

export type Origin = "source" | "ai" | "owner";

const origin = {
  origin: text("origin").$type<Origin>().notNull(),
  aiRole: text("ai_role"),
  aiModel: text("ai_model"),
  aiDate: text("ai_date"),
};

export const objects = sqliteTable("objects", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  title: text("title"),
  private: integer("private", { mode: "boolean" }).notNull().default(false),
  unreviewed: integer("unreviewed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const fieldValues = sqliteTable("field_values", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: text("object_id").notNull(),
  field: text("field").notNull(),
  value: text("value").notNull(),
  ...origin,
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
});

export const objectTags = sqliteTable(
  "object_tags",
  { objectId: text("object_id").notNull(), tagId: integer("tag_id").notNull(), ...origin },
  (t) => [primaryKey({ columns: [t.objectId, t.tagId] })],
);

export const connections = sqliteTable("connections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fromId: text("from_id").notNull(),
  toId: text("to_id").notNull(),
  kind: text("kind").notNull().default("related"),
  ...origin,
});

export const blocks = sqliteTable("blocks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  objectId: text("object_id").notNull(),
  position: integer("position").notNull(),
  text: text("text").notNull(),
  ...origin,
});
