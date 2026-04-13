-- Custom Style Builder: structured metadata for store_skills
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS metadata JSONB;
