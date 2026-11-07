-- Build 13 (issue #36): the Researcher, Inquiries and kept answers.
--
-- An Inquiry (CONTEXT.md: Inquiry) is a question the owner puts to the Researcher, with its follow-ups and answers. It is
-- never an Object. Each question in it is a "turn". The question is the owner's words; the answer is AI Origin (ADR 0001).
CREATE TABLE inquiries (
  id          TEXT PRIMARY KEY,
  object_id   TEXT,                     -- the Object asked about; NULL = "Ask the Garden"
  created_at  TEXT NOT NULL,
  deleted_at  TEXT                      -- set = in the Bin (30 days, like an Object)
);

CREATE TABLE inquiry_turns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  inquiry_id     TEXT NOT NULL REFERENCES inquiries(id),
  question       TEXT NOT NULL,
  steps          TEXT NOT NULL DEFAULT '[]',   -- JSON: the real progress steps so far, [{label, done}]
  picked         TEXT,                          -- JSON: the Objects the first request chose to read (kept so a retry skips that request)
  answer         TEXT,                          -- the Researcher's answer; links are [[o:<id>]] and only to Objects it really read
  read_ids       TEXT,                          -- JSON: the Objects it read for this answer
  private_count  INTEGER,                       -- Private Objects that match the question, counted on this Mac; never read
  error          TEXT,
  ai_role        TEXT,
  ai_model       TEXT,
  ai_date        TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX inquiry_turns_inquiry ON inquiry_turns (inquiry_id);

-- A Researcher job belongs to one turn.
ALTER TABLE ai_jobs ADD COLUMN turn_id INTEGER;

-- An AI Note may now also be a kept Researcher answer ('answer'), with a link back to the question it came from.
-- (SQLite can't change a CHECK, so the table is rebuilt; nothing else changes.)
CREATE TABLE ai_notes_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('summary', 'prompt', 'answer')),
  text        TEXT NOT NULL,
  ai_role     TEXT NOT NULL,
  ai_model    TEXT NOT NULL,
  ai_date     TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  inquiry_id  TEXT,                     -- where a kept answer came from (kept even if the Inquiry is deleted)
  question    TEXT                      -- the question it answered, so the link back still reads after the Inquiry is gone
);
INSERT INTO ai_notes_new (id, object_id, kind, text, ai_role, ai_model, ai_date, created_at)
  SELECT id, object_id, kind, text, ai_role, ai_model, ai_date, created_at FROM ai_notes;
DROP TRIGGER notes_ai;
DROP TRIGGER notes_au;
DROP TRIGGER notes_ad;
DROP TABLE ai_notes;
ALTER TABLE ai_notes_new RENAME TO ai_notes;
CREATE INDEX ai_notes_object ON ai_notes (object_id);
CREATE TRIGGER notes_ai AFTER INSERT ON ai_notes BEGIN
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (-NEW.id, NEW.object_id, 'note', NEW.text);
END;
CREATE TRIGGER notes_au AFTER UPDATE ON ai_notes BEGIN
  DELETE FROM search_index WHERE rowid = -OLD.id;
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (-NEW.id, NEW.object_id, 'note', NEW.text);
END;
CREATE TRIGGER notes_ad AFTER DELETE ON ai_notes BEGIN
  DELETE FROM search_index WHERE rowid = -OLD.id;
END;
