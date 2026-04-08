-- Sprint 7: Events + Proposals tables
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID REFERENCES stores(id) NOT NULL,
    type            TEXT NOT NULL CHECK (type IN (
        'new_product', 'product_no_creatives', 'revenue_declining',
        'winner_detected', 'optimization_pending',
        'ad_underperforming', 'ad_winner', 'low_stock'
    )),
    product_id      UUID REFERENCES products(id),
    severity        TEXT DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    title           TEXT NOT NULL,
    description     TEXT,
    metadata        JSONB DEFAULT '{}',
    status          TEXT DEFAULT 'new' CHECK (status IN ('new', 'proposal_created', 'resolved', 'dismissed')),
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id        UUID REFERENCES stores(id) NOT NULL,
    event_id        UUID REFERENCES events(id),
    type            TEXT NOT NULL CHECK (type IN (
        'generate_creatives', 'optimize_listing', 'try_different_style',
        'generate_variations', 'pause_ad', 'scale_ad', 'restock_alert'
    )),
    product_id      UUID REFERENCES products(id),
    title           TEXT NOT NULL,
    description     TEXT,
    suggested_action JSONB NOT NULL,
    status          TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    rejected_reason TEXT,
    executed_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_store_status ON events(store_id, status);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_proposals_store_status ON proposals(store_id, status);
CREATE INDEX IF NOT EXISTS idx_proposals_pending ON proposals(status) WHERE status = 'pending';

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_select_events" ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_events" ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_events" ON events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_select_proposals" ON proposals FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_proposals" ON proposals FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_update_proposals" ON proposals FOR UPDATE TO authenticated USING (true);
