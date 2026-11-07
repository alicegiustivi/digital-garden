-- Build 8 (issue #31): the AI gate, the queue and the Archivist.
-- A job is one piece of AI work waiting its turn. lane: 0 = a Researcher question the owner is waiting on,
-- 1 = something the owner asked for, 2 = a fresh capture (oldest first).
CREATE TABLE ai_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  role        TEXT NOT NULL CHECK (role IN ('archivist', 'researcher')),
  object_id   TEXT,
  lane        INTEGER NOT NULL CHECK (lane IN (0, 1, 2)),
  status      TEXT NOT NULL CHECK (status IN ('waiting', 'working', 'busy', 'tomorrow', 'failed', 'done', 'cancelled')),
  run_after   TEXT NOT NULL,          -- ISO time (UTC): not before this
  attempts    INTEGER NOT NULL DEFAULT 0,   -- tries that met a busy model (drives the 1, 5, 15, 30 min, then hourly retries)
  fails       INTEGER NOT NULL DEFAULT 0,   -- tries where the model answered but nothing usable came back
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX ai_jobs_object ON ai_jobs (object_id);

-- How many calls were made each UTC day, per role (OpenRouter counts its day in UTC).
CREATE TABLE ai_usage (
  day    TEXT NOT NULL,
  role   TEXT NOT NULL,
  calls  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, role)
);

-- Small facts the queue learns, such as when OpenRouter resets the daily count.
CREATE TABLE ai_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- What an Archivist run changed, so it can be undone in one click.
CREATE TABLE ai_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id   TEXT NOT NULL,
  model       TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  changes     TEXT NOT NULL,          -- JSON list of what was set and what was there before
  undone_at   TEXT
);

-- Things the owner turned down (a removed AI Tag): remembered and not proposed again.
CREATE TABLE ai_rejected (
  object_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  PRIMARY KEY (object_id, kind, value)
);
