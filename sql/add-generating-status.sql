-- Add 'generating' to creatives status check constraint
-- Run in Supabase SQL Editor

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_status_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_status_check
    CHECK (status IN ('generating', 'pending', 'approved', 'rejected', 'published'));

-- Also add show_model if not done yet
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS show_model BOOLEAN DEFAULT true;

-- Enable delete realtime
ALTER TABLE creatives REPLICA IDENTITY FULL;
