-- Sprint 11: Store Skills — compiled knowledge per category
CREATE TABLE IF NOT EXISTS store_skills (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id      UUID REFERENCES stores(id) NOT NULL,
    skill_type    TEXT NOT NULL,
    title         TEXT NOT NULL,
    content       TEXT NOT NULL,
    source_count  INTEGER DEFAULT 0,
    generated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(store_id, skill_type)
);

CREATE INDEX IF NOT EXISTS idx_store_skills_store_id ON store_skills(store_id);
