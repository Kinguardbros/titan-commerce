-- P1-11 (AUDIT-2026-08): migrate hardcoded BRAND_CONTEXTS dict (lib/actions/creatives.js)
-- and the isIsola high-waist-navel-hide gate (api/creatives/generate.js) into
-- stores.brand_config JSONB, so both are data-driven per store instead of hardcoded
-- by slug/name.
--
-- Idempotent: uses jsonb `||` shallow merge, which only overwrites the keys being set
-- (brand_voice, features.high_waist_navel_hide) and preserves every other existing
-- brand_config key (logo_black, logo_white, payment_fees, etc.). Safe to re-run.
--
-- Verified against live brand_config state on 2026-08-17 via:
--   SELECT id, slug, name, brand_config FROM stores ORDER BY slug;
-- Result: no store had brand_voice or features.* set yet.

-- Elegance House — brand_voice migrated verbatim from the old BRAND_CONTEXTS['elegance-house'].
UPDATE stores
SET brand_config = brand_config || jsonb_build_object(
  'brand_voice', 'BRAND: Elegance House — elegant women''s fashion for women 35-60. Warm gold tones (#d4a853), cream backgrounds (#f5f0e8), professional studio or lifestyle settings. Sophisticated, timeless, confident. Model: woman 35-55, approachable, not model-perfect.'
)
WHERE slug = 'elegance-house';

-- Isola — brand_voice migrated verbatim from the old BRAND_CONTEXTS['isola'], plus the
-- high_waist_navel_hide feature flag that replaces the old isIsola name-substring check
-- in api/creatives/generate.js.
UPDATE stores
SET brand_config = brand_config
  || jsonb_build_object(
    'brand_voice', 'BRAND: Isola World — tummy-control swimwear for women 30-55. Ocean blues, warm sand tones, coral accents. Beach, poolside, resort settings, golden hour lighting. Natural curvy body (size 10-18), authentic and confident. Vacation vibes, not fashion shoot.'
  )
  || jsonb_build_object(
    'features', COALESCE(brand_config->'features', '{}'::jsonb) || jsonb_build_object('high_waist_navel_hide', true)
  )
WHERE slug = 'isola';

-- Eleganz Haus and any future store: no BRAND_CONTEXTS entry existed for them before this
-- fix, so no brand_voice is set here — generate_branded falls back to the generic
-- `BRAND: ${brandName}` prompt, same behavior as before this migration. Set
-- brand_config.brand_voice manually per store when a curated voice is written.

-- Verify:
-- SELECT slug, brand_config->>'brand_voice' AS brand_voice, brand_config->'features' AS features FROM stores ORDER BY slug;
