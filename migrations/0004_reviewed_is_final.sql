-- Build 5 (issue #28): an Object never becomes Unreviewed again (issue #16).
-- Capture makes Objects Unreviewed when they are created; after the owner ticks Reviewed, nothing can set it back.
CREATE TRIGGER objects_unreviewed_stays_off BEFORE UPDATE OF unreviewed ON objects
WHEN OLD.unreviewed = 0 AND NEW.unreviewed = 1
BEGIN SELECT RAISE(ABORT, 'an Object never becomes Unreviewed again'); END;
