-- Build 6 (issue #29): Connections and Mentions.
-- A Connection can carry an optional one-line note written by the owner (issue #7).
ALTER TABLE connections ADD COLUMN note TEXT;

-- A Mention is written in a body as [[o:<id>]]. Build 4 made 'mentions' Connections from a Thought to its Sources
-- without putting them in the text; give each one its own line in the Thought, so the body shows what the Connection says.
INSERT INTO blocks (object_id, position, text, origin)
SELECT from_id, base + rn, '[[o:' || to_id || ']]', 'owner' FROM (
  SELECT c.from_id, c.to_id,
         row_number() OVER (PARTITION BY c.from_id ORDER BY c.id) AS rn,
         (SELECT coalesce(max(position), -1) FROM blocks b WHERE b.object_id = c.from_id) AS base
  FROM connections c
  WHERE c.kind = 'mentions'
    AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.object_id = c.from_id AND instr(b.text, '[[o:' || c.to_id || ']]') > 0)
);
