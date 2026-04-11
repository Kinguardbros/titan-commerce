-- Sprint 10: Add OAuth credentials to stores table
ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_id TEXT;
ALTER TABLE stores ADD COLUMN IF NOT EXISTS client_secret TEXT;

-- IMPORTANT: Set credentials manually in Supabase SQL Editor:
-- UPDATE stores SET
--   client_id = '<your-client-id>',
--   client_secret = '<your-client-secret>'
-- WHERE slug = 'isola';
--
-- Get these from your Shopify Partners Dashboard > App > Client credentials
