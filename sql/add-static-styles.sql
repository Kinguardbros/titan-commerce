-- Update creatives style constraint to include static templates
-- Run in Supabase SQL Editor

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_style_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_style_check
    CHECK (style IN ('ad_creative', 'product_shot', 'lifestyle', 'review_ugc', 'static_clean', 'static_split', 'static_urgency'));
