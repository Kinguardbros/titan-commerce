-- Product optimizations + product docs tables
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS product_optimizations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id      UUID REFERENCES products(id) NOT NULL,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    original_data   JSONB NOT NULL,
    optimized_data  JSONB NOT NULL,
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_docs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id    UUID REFERENCES products(id) NOT NULL,
    filename      TEXT NOT NULL,
    storage_path  TEXT NOT NULL,
    file_url      TEXT NOT NULL,
    file_type     TEXT,
    content       TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_optimizations_status ON product_optimizations(status);
CREATE INDEX IF NOT EXISTS idx_product_optimizations_product ON product_optimizations(product_id);
