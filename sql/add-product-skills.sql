-- Per-product skills support
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS product_name TEXT;
ALTER TABLE store_knowledge ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Update unique constraint to allow per-product skills
ALTER TABLE store_skills DROP CONSTRAINT IF EXISTS store_skills_store_id_skill_type_key;
ALTER TABLE store_skills ADD CONSTRAINT store_skills_store_id_skill_type_product_key UNIQUE(store_id, skill_type, product_name);
