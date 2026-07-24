-- ============================================================================
-- Export Isola products (title + URL + visibility) from Titan Commerce Supabase
-- ============================================================================
-- Supabase project: ercrkgfihqgrbkkqnoqy
--
-- HOW TO RUN:
--   1. Open Supabase dashboard → project `ercrkgfihqgrbkkqnoqy`
--   2. Left sidebar → SQL Editor → "New query"
--   3. Paste one of the variants below and click "Run"
--   4. Below the results, click the "Download CSV" button (top-right of results)
--
-- Store identification:
--   `stores` table has slug='isola', shopify_url='swimwear-brand.myshopify.com'.
--   Products join via `products.store_id = stores.id`. We match on slug (stable).
--
-- Column notes (verified against sql/products.sql, sql/add-stores.sql,
-- lib/product-upsert.js):
--   - products.title          TEXT NOT NULL
--   - products.handle         TEXT UNIQUE NOT NULL
--   - products.product_url    TEXT  -- populated at upsert as
--                                   -- https://{store.shopify_url}/products/{handle}
--                                   -- i.e. https://swimwear-brand.myshopify.com/products/xxx
--                                   -- (myshopify domain, NOT the custom isolaswim.com domain)
--   - products.status         TEXT  -- hardcoded 'active' on upsert; 'archived'
--                                   -- for products removed from Shopify.
--                                   -- May be NULL for very old rows.
--   - products.store_id       UUID FK → stores.id
--
-- ----------------------------------------------------------------------------
-- NOTE (2026-07-23): "Unlisted" state can't be exported today.
--   Titan DB doesn't sync the real Shopify status (hardcoded 'active' in
--   lib/product-upsert.js:25) and there is no column tracking Online Store
--   publication (Online Store channel on/off). After feature-01-publications-
--   manager ships, the CSV will distinguish draft / listed / unlisted /
--   archived. Until then:
--       visibility = 'archived'  when products.status = 'archived'
--       visibility = 'active'    for everything else (fallback — includes
--                                anything that might actually be draft or
--                                unlisted on Shopify; we can't tell yet)
-- ----------------------------------------------------------------------------
-- ============================================================================


-- ----------------------------------------------------------------------------
-- VARIANT A — ALL Isola products (active + archived + null-status)
-- ----------------------------------------------------------------------------
SELECT
    p.title,
    p.product_url,
    CASE
        WHEN p.status = 'archived' THEN 'archived'
        WHEN p.status = 'active' OR p.status IS NULL THEN 'active'
        ELSE p.status
    END AS visibility
FROM products p
JOIN stores s ON s.id = p.store_id
WHERE s.slug = 'isola'
ORDER BY p.title;


-- ----------------------------------------------------------------------------
-- VARIANT B — ONLY active Isola products
-- ----------------------------------------------------------------------------
SELECT
    p.title,
    p.product_url,
    CASE
        WHEN p.status = 'archived' THEN 'archived'
        WHEN p.status = 'active' OR p.status IS NULL THEN 'active'
        ELSE p.status
    END AS visibility
FROM products p
JOIN stores s ON s.id = p.store_id
WHERE s.slug = 'isola'
  AND (p.status = 'active' OR p.status IS NULL)
ORDER BY p.title;


-- ----------------------------------------------------------------------------
-- VARIANT C — First 100 active Isola products (quick sanity check)
-- ----------------------------------------------------------------------------
SELECT
    p.title,
    p.product_url,
    CASE
        WHEN p.status = 'archived' THEN 'archived'
        WHEN p.status = 'active' OR p.status IS NULL THEN 'active'
        ELSE p.status
    END AS visibility
FROM products p
JOIN stores s ON s.id = p.store_id
WHERE s.slug = 'isola'
  AND (p.status = 'active' OR p.status IS NULL)
ORDER BY p.title
LIMIT 100;


-- ----------------------------------------------------------------------------
-- FALLBACK — If the slug JOIN returns 0 rows (e.g. slug got renamed),
-- look up the store_id first, then paste it into the second query.
-- ----------------------------------------------------------------------------
-- Step 1: find the Isola store row
SELECT id, name, slug, shopify_url
FROM stores
WHERE slug ILIKE '%isola%'
   OR name ILIKE '%isola%'
   OR shopify_url ILIKE '%swimwear%';

-- Step 2: paste the id above into the query below (replace <PASTE_STORE_ID>)
-- SELECT
--     title,
--     product_url,
--     CASE
--         WHEN status = 'archived' THEN 'archived'
--         WHEN status = 'active' OR status IS NULL THEN 'active'
--         ELSE status
--     END AS visibility
-- FROM products
-- WHERE store_id = '<PASTE_STORE_ID>'
--   AND (status = 'active' OR status IS NULL)
-- ORDER BY title;


-- ----------------------------------------------------------------------------
-- BONUS — Swap the myshopify.com URL for the public custom domain
-- (product_url in DB is swimwear-brand.myshopify.com/products/xxx;
--  if you want the customer-facing isolaswim.com URLs instead, use this.)
-- ----------------------------------------------------------------------------
-- SELECT
--     p.title,
--     'https://isolaswim.com/products/' || p.handle AS product_url,
--     CASE
--         WHEN p.status = 'archived' THEN 'archived'
--         WHEN p.status = 'active' OR p.status IS NULL THEN 'active'
--         ELSE p.status
--     END AS visibility
-- FROM products p
-- JOIN stores s ON s.id = p.store_id
-- WHERE s.slug = 'isola'
--   AND (p.status = 'active' OR p.status IS NULL)
-- ORDER BY p.title;
