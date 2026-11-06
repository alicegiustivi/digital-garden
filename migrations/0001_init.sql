-- The Garden's first tables. Every piece of content (field value, Tag,
-- Connection, block of text) MUST carry an Origin (ADR 0001); the database
-- itself refuses anything without one.
--
-- origin: 'source' (came from outside) | 'ai' | 'owner'
-- AI pieces also record the role, model and date.

CREATE TABLE objects (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,                 -- source, concept, thought, person
  title       TEXT,
  private     INTEGER NOT NULL DEFAULT 0 CHECK (private IN (0, 1)),
  unreviewed  INTEGER NOT NULL DEFAULT 0 CHECK (unreviewed IN (0, 1)),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at  TEXT                            -- set = in the Bin
);

CREATE TABLE field_values (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id   TEXT NOT NULL REFERENCES objects(id),
  field       TEXT NOT NULL,
  value       TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('source', 'ai', 'owner')),
  ai_role     TEXT,
  ai_model    TEXT,
  ai_date     TEXT,
  CHECK (origin <> 'ai' OR (ai_role IS NOT NULL AND ai_model IS NOT NULL AND ai_date IS NOT NULL)),
  UNIQUE (object_id, field)
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL UNIQUE
);

CREATE TABLE object_tags (
  object_id   TEXT NOT NULL REFERENCES objects(id),
  tag_id      INTEGER NOT NULL REFERENCES tags(id),
  origin      TEXT NOT NULL CHECK (origin IN ('source', 'ai', 'owner')),
  ai_role     TEXT,
  ai_model    TEXT,
  ai_date     TEXT,
  CHECK (origin <> 'ai' OR (ai_role IS NOT NULL AND ai_model IS NOT NULL AND ai_date IS NOT NULL)),
  PRIMARY KEY (object_id, tag_id)
);

CREATE TABLE connections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     TEXT NOT NULL REFERENCES objects(id),
  to_id       TEXT NOT NULL REFERENCES objects(id),
  kind        TEXT NOT NULL DEFAULT 'related'
              CHECK (kind IN ('related','supports','contradicts','builds on','inspired by','mentions','authored by')),
  origin      TEXT NOT NULL CHECK (origin IN ('source', 'ai', 'owner')),
  ai_role     TEXT,
  ai_model    TEXT,
  ai_date     TEXT,
  CHECK (from_id <> to_id),
  CHECK (origin <> 'ai' OR (ai_role IS NOT NULL AND ai_model IS NOT NULL AND ai_date IS NOT NULL))
);
-- At most one Connection between two Objects, whichever way round.
CREATE UNIQUE INDEX connections_pair ON connections (min(from_id, to_id), max(from_id, to_id));

CREATE TABLE blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id   TEXT NOT NULL REFERENCES objects(id),
  position    INTEGER NOT NULL,
  text        TEXT NOT NULL,
  origin      TEXT NOT NULL CHECK (origin IN ('source', 'ai', 'owner')),
  ai_role     TEXT,
  ai_model    TEXT,
  ai_date     TEXT,
  CHECK (origin <> 'ai' OR (ai_role IS NOT NULL AND ai_model IS NOT NULL AND ai_date IS NOT NULL)),
  UNIQUE (object_id, position)
);

-- Full-text search (FTS5). Kept up to date by the triggers below.
CREATE VIRTUAL TABLE search_index USING fts5(
  object_id UNINDEXED, kind UNINDEXED, text,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (NEW.id * 2, NEW.object_id, 'block', NEW.text);
END;
CREATE TRIGGER blocks_au AFTER UPDATE ON blocks BEGIN
  DELETE FROM search_index WHERE rowid = OLD.id * 2;
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (NEW.id * 2, NEW.object_id, 'block', NEW.text);
END;
CREATE TRIGGER blocks_ad AFTER DELETE ON blocks BEGIN
  DELETE FROM search_index WHERE rowid = OLD.id * 2;
END;

CREATE TRIGGER fields_ai AFTER INSERT ON field_values BEGIN
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (NEW.id * 2 + 1, NEW.object_id, 'field', NEW.value);
END;
CREATE TRIGGER fields_au AFTER UPDATE ON field_values BEGIN
  DELETE FROM search_index WHERE rowid = OLD.id * 2 + 1;
  INSERT INTO search_index (rowid, object_id, kind, text) VALUES (NEW.id * 2 + 1, NEW.object_id, 'field', NEW.value);
END;
CREATE TRIGGER fields_ad AFTER DELETE ON field_values BEGIN
  DELETE FROM search_index WHERE rowid = OLD.id * 2 + 1;
END;
