// Upload store logos to Supabase Storage and update brand_config
// Run: node scripts/upload-logos.mjs
// Requires: store-assets bucket created in Supabase (public)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const LOGOS = [
  { file: 'Docs/Brands/Elegance House/EleganceHouse_white.png', path: 'elegance-house/logo_white.png', slug: 'elegance-house', key: 'logo_white' },
  { file: 'Docs/Brands/Elegance House/elegancehouse_black.png', path: 'elegance-house/logo_black.png', slug: 'elegance-house', key: 'logo_black' },
  { file: 'Docs/Brands/Isola/isola_white.png', path: 'isola/logo_white.png', slug: 'isola', key: 'logo_white' },
  { file: 'Docs/Brands/Isola/isola_black.png', path: 'isola/logo_black.png', slug: 'isola', key: 'logo_black' },
];

const storeConfigs = {};

for (const logo of LOGOS) {
  console.log(`Uploading ${logo.file} → store-assets/${logo.path}`);
  const buf = readFileSync(logo.file);

  const { error } = await supabase.storage
    .from('store-assets')
    .upload(logo.path, buf, { contentType: 'image/png', upsert: true });

  if (error) {
    console.error(`  Error: ${error.message}`);
    continue;
  }

  const { data: pub } = supabase.storage.from('store-assets').getPublicUrl(logo.path);
  const url = pub.publicUrl;
  console.log(`  URL: ${url}`);

  if (!storeConfigs[logo.slug]) storeConfigs[logo.slug] = {};
  storeConfigs[logo.slug][logo.key] = url;
}

// Update brand_config for each store
for (const [slug, logos] of Object.entries(storeConfigs)) {
  const { data: store } = await supabase.from('stores').select('brand_config').eq('slug', slug).single();
  const existing = store?.brand_config || {};
  const updated = { ...existing, ...logos };

  const { error } = await supabase.from('stores').update({ brand_config: updated }).eq('slug', slug);
  if (error) console.error(`Failed to update ${slug}:`, error.message);
  else console.log(`Updated ${slug} brand_config:`, JSON.stringify(updated));
}

console.log('Done!');
