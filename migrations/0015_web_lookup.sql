-- Issue #108 (ADR 0009): the Archivist and the Researcher can look basic facts up on the web.
-- A looked-up value is Source Origin (it came from outside) and always keeps the link it came from.
ALTER TABLE field_values ADD COLUMN source_url  TEXT;
ALTER TABLE field_values ADD COLUMN source_name TEXT;
ALTER TABLE field_values ADD COLUMN source_date TEXT;

-- A property of a type the owner made may be filled from the web only when the owner says so, and says what kind of fact it takes:
-- 'summary' (a short description), 'year' (a year: born, founded, published) or 'link' (the address of its Wikipedia page).
ALTER TABLE field_definitions ADD COLUMN lookup TEXT CHECK (lookup IN ('summary', 'year', 'link'));

-- A looked-up value waits as a Suggestion ('fact': data = field, value, site, url, candidate). SQLite can't change a CHECK, so the table is rebuilt.
CREATE TABLE ai_suggestions_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id  TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('connection', 'type', 'object', 'title', 'fact')),
  data       TEXT NOT NULL,
  ai_role    TEXT NOT NULL,
  ai_model   TEXT NOT NULL,
  ai_date    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO ai_suggestions_new SELECT id, object_id, kind, data, ai_role, ai_model, ai_date, created_at FROM ai_suggestions;
DROP TABLE ai_suggestions;
ALTER TABLE ai_suggestions_new RENAME TO ai_suggestions;
CREATE INDEX ai_suggestions_object ON ai_suggestions (object_id);

-- The Researcher's web switch is per Inquiry (off unless the owner turns it on); what it found for one question is kept on that question.
ALTER TABLE inquiries ADD COLUMN web INTEGER NOT NULL DEFAULT 0 CHECK (web IN (0, 1));
ALTER TABLE inquiry_turns ADD COLUMN web TEXT;
