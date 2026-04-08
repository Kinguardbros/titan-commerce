-- ============================================================
-- ELEGANCE HOUSE — Ad Pipeline Database Schema
-- Supabase project: https://ercrkgfihqgrbkkqnoqy.supabase.co
-- Run this in Supabase SQL Editor
-- ============================================================

-- Briefs from SCRAPER
CREATE TABLE briefs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name  TEXT NOT NULL,
    product_url   TEXT NOT NULL,
    price         TEXT,
    hooks         JSONB NOT NULL,        -- string[]
    headlines     JSONB NOT NULL,        -- string[]
    visual_refs   JSONB NOT NULL,        -- string[]
    tone          TEXT,
    brief_text    TEXT,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Creatives from FORGE
CREATE TABLE creatives (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id      UUID REFERENCES briefs(id),
    variant_index INTEGER NOT NULL,
    format        TEXT NOT NULL CHECK (format IN ('image', 'video')),
    file_url      TEXT NOT NULL,         -- Higgsfield output URL
    storage_path  TEXT,                  -- Supabase Storage path (creatives/{id}.jpg)
    hook_used     TEXT,
    headline      TEXT,
    hf_job_id     TEXT,                  -- Higgsfield request ID
    status        TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'published')),
    approved_by   TEXT,                  -- Team member name
    approved_at   TIMESTAMPTZ,
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Ads on Meta (PUBLISHER)
CREATE TABLE ads (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id   UUID REFERENCES creatives(id),
    meta_ad_id    TEXT UNIQUE,
    meta_adset_id TEXT,
    campaign_id   TEXT NOT NULL,
    status        TEXT DEFAULT 'learning' CHECK (status IN ('active', 'paused', 'learning', 'ended', 'rejected')),
    daily_budget  NUMERIC(10,2) DEFAULT 50.00,
    objective     TEXT,
    targeting     JSONB,
    published_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Performance data (LOOPER)
CREATE TABLE performance (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_id         UUID REFERENCES ads(id),
    meta_ad_id    TEXT NOT NULL,
    date          DATE NOT NULL,
    spend         NUMERIC(10,2),
    revenue       NUMERIC(10,2),
    impressions   INTEGER,
    clicks        INTEGER,
    conversions   INTEGER,
    roas          NUMERIC(6,2),
    ctr           NUMERIC(6,3),
    cpc           NUMERIC(10,2),
    score         NUMERIC(4,2),          -- Composite score from LOOPER
    is_winner     BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE(meta_ad_id, date)
);

-- Winner reference prompts (LOOPER → FORGE)
CREATE TABLE winner_refs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_ad_id  UUID REFERENCES ads(id),
    hook          TEXT NOT NULL,
    headline      TEXT,
    visual_notes  TEXT,
    roas          NUMERIC(6,2),
    ctr           NUMERIC(6,3),
    brief_addendum TEXT,
    used          BOOLEAN DEFAULT false,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Pipeline log (for terminal in dashboard)
CREATE TABLE pipeline_log (
    id            SERIAL PRIMARY KEY,
    agent         TEXT NOT NULL CHECK (agent IN ('SCRAPER', 'FORGE', 'PUBLISHER', 'LOOPER')),
    message       TEXT NOT NULL,
    level         TEXT DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error')),
    metadata      JSONB,
    created_at    TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_creatives_status ON creatives(status);
CREATE INDEX idx_ads_status ON ads(status);
CREATE INDEX idx_performance_date ON performance(date);
CREATE INDEX idx_pipeline_log_created ON pipeline_log(created_at DESC);
