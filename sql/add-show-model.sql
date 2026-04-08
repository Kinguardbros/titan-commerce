-- Add show_model column to creatives
-- Run in Supabase SQL Editor

ALTER TABLE creatives ADD COLUMN IF NOT EXISTS show_model BOOLEAN DEFAULT true;
