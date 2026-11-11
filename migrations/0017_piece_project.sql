-- Express, ticket 1 (map #113, issue #139): Piece and Project become Core Object Types, after People.
-- A Project is something the owner is making or doing; a Piece is a piece of work the owner writes for others to read.
-- Both carry a Stage (set only by the owner, no dates) and an optional About line, and nothing else (ADR 0008: Core types stay fixed).
-- Stage has its own field per type because the choices differ: Idea / Drafting / Finished for a Piece, Active / Paused / Finished for a Project.

-- Make room right after the last Core type already there (People), so a type the owner made stays after the new ones.
UPDATE object_types SET position = position + 2 WHERE position > (SELECT position FROM object_types WHERE key = 'person');
INSERT INTO object_types (key, label, plural, position, color, icon, core) VALUES
  ('project', 'Project', 'Projects', (SELECT position + 1 FROM object_types WHERE key = 'person'), 'green',  'book', 1),
  ('piece',   'Piece',   'Pieces',   (SELECT position + 2 FROM object_types WHERE key = 'person'), 'orange', 'pen',  1);

INSERT INTO field_definitions (key, label, input, options) VALUES
  ('about',         'About', 'text',   NULL),
  ('stage-project', 'Stage', 'select', '["Active","Paused","Finished"]'),
  ('stage-piece',   'Stage', 'select', '["Idea","Drafting","Finished"]');

INSERT INTO type_fields (type, field, position, lead) VALUES
  ('project', 'stage-project', 0, 0),
  ('project', 'about',         1, 1),
  ('piece',   'stage-piece',   0, 0),
  ('piece',   'about',         1, 1);
