-- Product docs table for AI context
-- Run in Supabase SQL Editor

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
