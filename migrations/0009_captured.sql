-- Build 10 (issue #33): the Timeline tells "captured" from "written". Unreviewed goes off once the owner ticks Reviewed,
-- so Capture now also leaves a permanent mark. Older Objects are marked when they are still Unreviewed or hold facts from a Source.
ALTER TABLE objects ADD COLUMN captured INTEGER NOT NULL DEFAULT 0;
UPDATE objects SET captured = 1 WHERE unreviewed = 1 OR EXISTS (SELECT 1 FROM field_values f WHERE f.object_id = objects.id AND f.origin = 'source');
