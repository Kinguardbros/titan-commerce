-- Sprint 11B: Add new_document event type + process_inbox proposal type
-- Only needed if tables have CHECK constraints on type column

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_type_check;

-- If your tables don't use CHECK constraints (just TEXT columns), this SQL is optional.
-- The code will work with plain TEXT columns without constraints.
