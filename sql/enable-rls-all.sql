-- Enable RLS on all tables + audit logging column
-- Run in Supabase SQL Editor AFTER auth is deployed

-- Audit logging
ALTER TABLE pipeline_log ADD COLUMN IF NOT EXISTS user_email TEXT;

-- Enable RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE manual_adspend ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE winner_refs ENABLE ROW LEVEL SECURITY;

-- Policies: authenticated users get full access
-- Service role (backend) bypasses RLS automatically

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'products', 'creatives', 'ads', 'performance', 'briefs',
    'pipeline_log', 'manual_adspend', 'product_optimizations',
    'product_docs', 'winner_refs'
  ])
  LOOP
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_select_%s" ON %I FOR SELECT TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_insert_%s" ON %I FOR INSERT TO authenticated WITH CHECK (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_update_%s" ON %I FOR UPDATE TO authenticated USING (true)', tbl, tbl);
    EXECUTE format('CREATE POLICY IF NOT EXISTS "auth_delete_%s" ON %I FOR DELETE TO authenticated USING (true)', tbl, tbl);
  END LOOP;
END $$;
