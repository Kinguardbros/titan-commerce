-- Add COGS to products + manual adspend table
-- Run in Supabase SQL Editor

ALTER TABLE products ADD COLUMN IF NOT EXISTS cogs NUMERIC(10,2);

CREATE TABLE IF NOT EXISTS manual_adspend (
    id          SERIAL PRIMARY KEY,
    date        DATE NOT NULL,
    channel     TEXT NOT NULL CHECK (channel IN ('tiktok', 'pinterest', 'other')),
    amount      NUMERIC(10,2) NOT NULL,
    currency    TEXT DEFAULT 'USD',
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date, channel)
);
