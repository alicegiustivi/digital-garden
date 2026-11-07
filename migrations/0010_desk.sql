-- Build 12 (issue #35): the Concept page as a Distill desk.
-- Earlier versions of a Concept's view, one per day at most (CONTEXT.md: Concept). They are the owner's words (ADR 0001),
-- can be read, and are never deleted one by one: they go only when the Concept itself is gone for good.
CREATE TABLE concept_versions (
  object_id   TEXT NOT NULL,
  day         TEXT NOT NULL,                    -- the owner's local day, YYYY-MM-DD
  paragraphs  TEXT NOT NULL,                    -- JSON list of the view's paragraphs as they stood at the end of that day
  saved_at    TEXT NOT NULL DEFAULT (datetime('now')),
  origin      TEXT NOT NULL DEFAULT 'owner' CHECK (origin = 'owner'),
  PRIMARY KEY (object_id, day)
);

-- An Open Question is a Thought the owner has marked (CONTEXT.md: Open Question). Only the owner makes one, so every row is
-- the owner's. Settled for now keeps its date and can be reopened. There is no due date and nothing is ever overdue.
CREATE TABLE open_questions (
  object_id   TEXT PRIMARY KEY,
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at  TEXT,
  settled_by  TEXT,                              -- optional: the Thought that settled it
  origin      TEXT NOT NULL DEFAULT 'owner' CHECK (origin = 'owner')
);

-- "From your Garden" items the owner sent away: they don't come back.
CREATE TABLE garden_dismissed (
  object_id     TEXT PRIMARY KEY,
  dismissed_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
