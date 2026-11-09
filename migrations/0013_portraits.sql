-- Issue #69: a Person gets a Portrait, a photo the owner adds. It is the owner's (Owner Origin) and is kept as a shrunk
-- copy (about 2048 px) plus a thumbnail in ~/Garden/images, like other pictures. It lives in its own table, not in
-- field_values and not in source_images, so no AI step ever reads it by accident.
CREATE TABLE person_portraits (
  object_id  TEXT PRIMARY KEY REFERENCES objects(id),
  stem       TEXT NOT NULL,              -- file name without .jpg: portrait-<object id>-<version>
  width      INTEGER,
  height     INTEGER,
  origin     TEXT NOT NULL DEFAULT 'owner' CHECK (origin = 'owner')
);
