-- Build 4: links and images (issue #27).
-- A link's reading status is a Source field. An image Source keeps one shrunk copy plus a thumbnail
-- on disk (~/Garden/images); no full-size original is kept.

INSERT INTO field_definitions (key, label, input, options) VALUES
  ('extraction', 'Reading', 'select', '["reading","extracted","partial","bookmark only"]');
INSERT INTO type_fields (type, field, position, lead) VALUES ('source', 'extraction', 6, 0);

CREATE TABLE source_images (
  object_id  TEXT PRIMARY KEY REFERENCES objects(id),
  file       TEXT NOT NULL,   -- shrunk copy, about 2048 px
  thumb      TEXT NOT NULL,   -- about 400 px
  width      INTEGER,
  height     INTEGER
);
