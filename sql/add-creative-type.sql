-- Add type column to creatives for branded vs product content
-- Run in Supabase SQL Editor

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'product';

-- Drop old constraint if exists and add new one with branded types
ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_type_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_type_check
    CHECK (type IN ('product', 'branded_lifestyle', 'branded_banner', 'branded_social'));

-- Backfill existing records
UPDATE creatives SET type = 'product' WHERE type IS NULL;
