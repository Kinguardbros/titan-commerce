-- Allow custom styles (cs_* prefix) in creatives table
-- Previous constraint only allowed 7 hardcoded styles
ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_style_check;
ALTER TABLE creatives ADD CONSTRAINT creatives_style_check
    CHECK (style IN ('ad_creative', 'product_shot', 'product_photo_beach', 'lifestyle', 'review_ugc', 'static_clean', 'static_split', 'static_urgency') OR style LIKE 'cs_%');
