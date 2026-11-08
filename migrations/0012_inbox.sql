-- Build 14 (issue #37): the Daily Inbox. Phone captures arrive as folders in a Google Drive folder; each one the Garden
-- reads is remembered here (this is also how a message that arrives twice is recognised and kept once).
CREATE TABLE inbox_captures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,   -- "tg:<Telegram message id>", or "folder:<name>" when the description can't be read
  message_id  TEXT,
  folder      TEXT NOT NULL,          -- the folder's name inside the Drive inbox
  sent_at     TEXT NOT NULL,          -- when it was sent (UTC, like every date here)
  day         TEXT NOT NULL,          -- the day it belongs to by the Mac's clock, YYYY-MM-DD
  status      TEXT NOT NULL CHECK (status IN ('done', 'failed')),
  reason      TEXT,                   -- for failed: what went wrong
  refused     INTEGER NOT NULL DEFAULT 0,  -- failed on purpose (voice note, PDF, too big): retrying would change nothing
  comment     TEXT,                   -- the owner's words beside the Objects (Owner Origin); stays here until made a Thought
  private     INTEGER NOT NULL DEFAULT 0,
  thought_id  TEXT,                   -- set once the comment was turned into a Thought
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX inbox_captures_day ON inbox_captures (day);
CREATE TABLE inbox_objects (
  capture_id INTEGER NOT NULL REFERENCES inbox_captures(id) ON DELETE CASCADE,
  object_id  TEXT NOT NULL,
  position   INTEGER NOT NULL,
  PRIMARY KEY (capture_id, object_id)
);
-- A forwarded message is a Source of its own format.
UPDATE field_definitions SET options = '["book","article","video","podcast","web page","image","document","post"]' WHERE key = 'format';
