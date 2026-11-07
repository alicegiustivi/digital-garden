-- Build 10 (issue #33): Search, This week, Timeline and the Tags page.

-- AI Notes join the full-text index (kind 'note'). Their rowids are negative so they never meet the block (even)
-- and field (odd) rowids from migration 0001. Private Objects have no AI Notes, and deleting a note removes it here too.
INSERT INTO search_index (rowid, object_id, kind, text) SELECT -id, object_id, 'note', text FROM ai_notes;
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

-- Every word in the index, used to guess what a mistyped word was meant to be.
CREATE VIRTUAL TABLE search_vocab USING fts5vocab('search_index', 'row');

-- The Timeline needs to know when a Connection was made. Older ones get the later of their two Objects' dates.
ALTER TABLE connections ADD COLUMN created_at TEXT;
UPDATE connections SET created_at = max(
  coalesce((SELECT created_at FROM objects WHERE id = connections.from_id), datetime('now')),
  coalesce((SELECT created_at FROM objects WHERE id = connections.to_id), datetime('now')));
CREATE TRIGGER connections_stamp AFTER INSERT ON connections WHEN NEW.created_at IS NULL BEGIN
  UPDATE connections SET created_at = datetime('now') WHERE id = NEW.id;
END;
