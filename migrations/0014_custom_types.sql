-- Issue #107 (ADR 0008): the owner can make their own Object Types and choose each type's colour.
-- A type stores the KEY of a palette colour (src/shared/palette.ts), not a hex value, so the four core types
-- are pre-filled with exactly the colours they have always had and nothing looks different until the owner changes one.
-- `core` marks the four types that keep every special behaviour; a type the owner makes is a plain Object type (core = 0).
-- The trigger from 0002 that refuses an unknown type is untouched.
ALTER TABLE object_types ADD COLUMN color TEXT NOT NULL DEFAULT 'ocean';
ALTER TABLE object_types ADD COLUMN icon  TEXT NOT NULL DEFAULT 'box';
ALTER TABLE object_types ADD COLUMN core  INTEGER NOT NULL DEFAULT 0 CHECK (core IN (0, 1));

UPDATE object_types SET core = 1, icon = key, color = CASE key
  WHEN 'source' THEN 'ocean' WHEN 'concept' THEN 'violet' WHEN 'thought' THEN 'gold' WHEN 'person' THEN 'coral' END
WHERE key IN ('source', 'concept', 'thought', 'person');
