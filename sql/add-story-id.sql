-- Group creatives into photo stories
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS story_id UUID;
ALTER TABLE creatives ADD COLUMN IF NOT EXISTS story_shot TEXT;
CREATE INDEX IF NOT EXISTS idx_creatives_story_id ON creatives(story_id) WHERE story_id IS NOT NULL;
