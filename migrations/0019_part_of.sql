-- Express, ticket 2 (map #113, issue #140): a Piece is "part of" a Project.
-- A new Connection Kind, owner-only. The kind list is a CHECK on the table, so the table is rebuilt with "part of" allowed
-- (the database still refuses any other unknown kind). `position` is a Piece's place in its Project's outline (only used by "part of").
CREATE TABLE connections_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id     TEXT NOT NULL REFERENCES objects(id),
  to_id       TEXT NOT NULL REFERENCES objects(id),
  kind        TEXT NOT NULL DEFAULT 'related'
              CHECK (kind IN ('related','supports','contradicts','builds on','inspired by','mentions','authored by','part of')),
  origin      TEXT NOT NULL CHECK (origin IN ('source', 'ai', 'owner')),
  ai_role     TEXT,
  ai_model    TEXT,
  ai_date     TEXT,
  note        TEXT,
  approved    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT,
  position    INTEGER,
  CHECK (from_id <> to_id),
  CHECK (origin <> 'ai' OR (ai_role IS NOT NULL AND ai_model IS NOT NULL AND ai_date IS NOT NULL)),
  -- Only the owner makes a "part of": no AI role can.
  CHECK (kind <> 'part of' OR origin = 'owner')
);
INSERT INTO connections_new (id, from_id, to_id, kind, origin, ai_role, ai_model, ai_date, note, approved, created_at)
  SELECT id, from_id, to_id, kind, origin, ai_role, ai_model, ai_date, note, approved, created_at FROM connections;
DROP TABLE connections;
ALTER TABLE connections_new RENAME TO connections;
CREATE UNIQUE INDEX connections_pair ON connections (min(from_id, to_id), max(from_id, to_id));
CREATE TRIGGER connections_stamp AFTER INSERT ON connections WHEN NEW.created_at IS NULL BEGIN
  UPDATE connections SET created_at = datetime('now') WHERE id = NEW.id;
END;
