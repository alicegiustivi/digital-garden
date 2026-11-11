-- More kinds of property for a type the owner made (ADR 0010): a rating (1 to 5 stars) and an image (a book cover, a photo).
-- `kind` marks them; a rating is stored as its number in field_values (input 'text'), so nothing about the existing CHECK on `input` changes.
-- An image is a file the owner added, kept in the images folder like a Person's Portrait, and lives in its own table, so it is never
-- a field value: it is not searched, not exported as text and not read by any AI role.
ALTER TABLE field_definitions ADD COLUMN kind TEXT CHECK (kind IN ('rating', 'image'));

-- A property may also be filled from the web with a book's authors or first publication year (Open Library). SQLite can't widen the CHECK
-- on `lookup` (0015), so these two live in their own column. A property has at most one of the two.
ALTER TABLE field_definitions ADD COLUMN lookup_book TEXT CHECK (lookup_book IN ('authors', 'published'));

CREATE TABLE property_images (
  object_id TEXT NOT NULL REFERENCES objects(id),
  field     TEXT NOT NULL,
  stem      TEXT NOT NULL,
  width     INTEGER,
  height    INTEGER,
  PRIMARY KEY (object_id, field)
);
