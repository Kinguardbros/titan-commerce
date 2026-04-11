-- Sprint 11A: Store Knowledge table for processed document insights
CREATE TABLE IF NOT EXISTS store_knowledge (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id    UUID REFERENCES stores(id) NOT NULL,
    source_file TEXT NOT NULL,
    category    TEXT NOT NULL,
    insights    TEXT NOT NULL,
    processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_knowledge_store_id ON store_knowledge(store_id);
