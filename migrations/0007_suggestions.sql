-- Build 9 (issue #32): Suggestions and AI Notes.
-- A Suggestion waits for the owner's Approve or Reject. Only the Archivist makes them in this build.
--   kind: 'connection' (data: otherId, kind, subject), 'type' (data: type), 'object' (data: type, name, connectTo),
--         'title' (data: title; the only thing ever suggested on a Thought)
CREATE TABLE ai_suggestions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('connection', 'type', 'object', 'title')),
  data       TEXT NOT NULL,
  ai_role    TEXT NOT NULL,
  ai_model   TEXT NOT NULL,
  ai_date    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_suggestions_object ON ai_suggestions (object_id);

-- An AI Note: AI-written text kept beside an Object's body, never inside it (ADR 0001). It always has AI Origin.
--   kind: 'summary' (made by the Archivist) | 'prompt' (a copy attached to a Thought started from a note)
CREATE TABLE ai_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('summary', 'prompt')),
  text        TEXT NOT NULL,
  ai_role     TEXT NOT NULL,
  ai_model    TEXT NOT NULL,
  ai_date     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX ai_notes_object ON ai_notes (object_id);

-- "Approved": the owner accepted an AI Suggestion. It keeps AI Origin for good, with a quieter mark (ADR 0001).
ALTER TABLE connections ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;
ALTER TABLE field_values ADD COLUMN approved INTEGER NOT NULL DEFAULT 0;

-- A change of Object Type the owner approved from the Archivist (JSON: role, model, date). The owner changing it back clears it.
ALTER TABLE objects ADD COLUMN type_ai TEXT;
-- The day an Object became Private after the AI had already read it ("AI read this before it became Private on …").
ALTER TABLE objects ADD COLUMN ai_read_before_private TEXT;
