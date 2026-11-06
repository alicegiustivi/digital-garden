-- Build 2: Object Types as data (issue #6), Tag colours, updated dates.
-- Object Types and their fields are rows, not hard-coded tables, so types can
-- later become user-defined. Field values live in field_values (0001) keyed by
-- field name, so changing an Object's type never drops a value.

CREATE TABLE object_types (
  key       TEXT PRIMARY KEY,        -- source, concept, thought, person
  label     TEXT NOT NULL,           -- Source
  plural    TEXT NOT NULL,           -- Sources
  position  INTEGER NOT NULL
);

-- Fields are defined once and shared across types.
CREATE TABLE field_definitions (
  key      TEXT PRIMARY KEY,
  label    TEXT NOT NULL,
  input    TEXT NOT NULL CHECK (input IN ('text', 'longtext', 'select')),
  options  TEXT                       -- JSON list, for 'select'
);

CREATE TABLE type_fields (
  type      TEXT NOT NULL REFERENCES object_types(key),
  field     TEXT NOT NULL REFERENCES field_definitions(key),
  position  INTEGER NOT NULL,
  lead      INTEGER NOT NULL DEFAULT 0 CHECK (lead IN (0, 1)),  -- shown as the standfirst under the title
  PRIMARY KEY (type, field)
);

INSERT INTO object_types (key, label, plural, position) VALUES
  ('source',  'Source',  'Sources',  1),
  ('concept', 'Concept', 'Concepts', 2),
  ('thought', 'Thought', 'Thoughts', 3),
  ('person',  'Person',  'People',   4);

INSERT INTO field_definitions (key, label, input, options) VALUES
  ('format',      'Format',         'select', '["book","article","video","podcast","web page","image","document"]'),
  ('link',        'Link',           'text',   NULL),
  ('authors',     'Authors',        'text',   NULL),
  ('published',   'Published',      'text',   NULL),
  ('captured',    'Captured text',  'longtext', NULL),
  ('status',      'Status',         'select', '["to read","reading","done"]'),
  ('definition',  'Definition',     'longtext', NULL),
  ('aliases',     'Aliases',        'text',   NULL),
  ('kind',        'Kind',           'select', '["reflection","insight","question","observation"]'),
  ('description', 'Description',    'longtext', NULL),
  ('links',       'Links',          'text',   NULL),
  ('years',       'Years lived',    'text',   NULL);

INSERT INTO type_fields (type, field, position, lead) VALUES
  ('source', 'captured',   0, 1),
  ('source', 'format',     1, 0),
  ('source', 'status',     2, 0),
  ('source', 'authors',    3, 0),
  ('source', 'published',  4, 0),
  ('source', 'link',       5, 0),
  ('concept', 'definition', 0, 1),
  ('concept', 'aliases',    1, 0),
  ('thought', 'kind',       0, 0),
  ('person', 'description', 0, 1),
  ('person', 'years',       1, 0),
  ('person', 'links',       2, 0);

-- An Object can only have a type that exists.
CREATE TRIGGER objects_type_ai BEFORE INSERT ON objects
WHEN NEW.type NOT IN (SELECT key FROM object_types)
BEGIN SELECT RAISE(ABORT, 'unknown Object Type'); END;
CREATE TRIGGER objects_type_au BEFORE UPDATE OF type ON objects
WHEN NEW.type NOT IN (SELECT key FROM object_types)
BEGIN SELECT RAISE(ABORT, 'unknown Object Type'); END;

ALTER TABLE objects ADD COLUMN updated_at TEXT;
ALTER TABLE tags ADD COLUMN color TEXT NOT NULL DEFAULT 'blue';
