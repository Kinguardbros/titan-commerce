import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SCOPES = [
  'read_all_orders', 'read_analytics', 'read_products', 'write_products',
  'read_customers', 'read_inventory', 'read_orders',
  'write_metaobjects', 'write_metaobject_definitions',
  'read_metaobjects', 'read_metaobject_definitions',
  'write_discounts', 'read_discounts', 'read_reports',
  'read_publications', 'write_publications',
].join(',');

const REDIRECT_URI = (process.env.APP_URL || 'https://titan-commerce.vercel.app') + '/api/auth/shopify';

function verifyHmac(query, secret) {
  const { hmac, ...params } = query;
  if (!hmac) return false;
  const message = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const digest = crypto.createHmac('sha256', secret).update(message).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(hmac, 'hex'));
  } catch (err) {
    console.error('[ShopifyAuth] HMAC verification failed:', { error: err.message });
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Route: if `code` is present → callback; if `store_id` → connect
  const isCallback = !!req.query.code;

  // ═══ CONNECT — initiate OAuth ═══
  if (!isCallback) {
    const storeId = req.query.store_id;
    if (!storeId) return res.status(400).json({ error: 'store_id required' });

    const { data: store } = await supabase.from('stores').select('id, shopify_url, client_id').eq('id', storeId).single();
    if (!store?.client_id) return res.status(400).json({ error: 'Store has no OAuth credentials configured' });

    // Generate state nonce for CSRF protection
    const nonce = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Store nonce in oauth_nonces (P2 fix, AUDIT-2026-08) — the CALLBACK step
    // below validates the `state` nonce against this row (single-use, TTL'd).
    // A DB table, not an in-memory Map: CONNECT and CALLBACK are always two
    // separate Vercel invocations separated by a Shopify-side redirect, so an
    // in-memory cache would almost never still hold the nonce by callback time.
    const { error: nonceInsertError } = await supabase.from('oauth_nonces').insert({
      nonce, store_id: storeId, expires_at: expiresAt,
    });
    if (nonceInsertError) {
      console.error('[shopify-oauth] Failed to store OAuth nonce:', nonceInsertError);
      return res.status(500).json({ error: 'Failed to initiate OAuth' });
    }

    await supabase.from('pipeline_log').insert({
      agent: 'AUTH',
      message: `OAuth nonce generated for ${store.shopify_url}`,
      level: 'info',
      // Nonce value itself intentionally NOT logged here (it's a secret) — the
      // oauth_nonces row above is the actual validation source of truth.
      metadata: { store_id: storeId, expires_at: expiresAt },
      user_id: null, initiator: 'user',
    });

    const authUrl = `https://${store.shopify_url}/admin/oauth/authorize` +
      `?client_id=${store.client_id}` +
      `&scope=${SCOPES}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&state=${storeId}:${nonce}`;

    return res.redirect(302, authUrl);
  }

  // ═══ CALLBACK — exchange code for token ═══
  if (isCallback) {
    const { code, shop, state, hmac } = req.query;

    // P2 fix (AUDIT-2026-08): fail CLOSED when Shopify omits the hmac param,
    // instead of silently skipping verification (was: `if (hmac && !verifyHmac(...))`,
    // i.e. no hmac at all = no check at all). A genuine Shopify OAuth callback
    // always includes hmac — its absence means a stripped param (MITM / broken
    // proxy) or a forged callback URL.
    if (!hmac) {
      console.error('[shopify-oauth] Callback missing hmac param for shop:', shop);
      return res.status(400).json({ error: 'OAuth HMAC required' });
    }

    if (!code || !shop || !state) {
      return res.redirect('/?error=missing_params');
    }

    // Parse state → storeId:nonce
    const [storeId, nonce] = (state || '').split(':');
    if (!storeId || !nonce) return res.redirect('/?error=invalid_state');

    // Load store with client_secret for HMAC verification
    const { data: store } = await supabase.from('stores').select('id, shopify_url, client_id, client_secret').eq('id', storeId).single();
    if (!store?.client_secret) return res.redirect('/?error=store_not_found');

    // Verify HMAC (crypto.timingSafeEqual inside verifyHmac, unchanged)
    if (!verifyHmac(req.query, store.client_secret)) {
      console.error('[shopify-oauth] HMAC verification failed for', shop);
      return res.redirect('/?error=hmac_failed');
    }

    // Nonce validation (P2 fix, AUDIT-2026-08): the nonce issued at CONNECT
    // time must exist, be unexpired, and be single-use — HMAC alone proves the
    // callback came from Shopify, but not that it's a reply to *this*
    // browser's connect attempt within a reasonable window.
    const { data: storedNonce, error: nonceLookupError } = await supabase
      .from('oauth_nonces')
      .select('nonce, expires_at')
      .eq('nonce', nonce)
      .eq('store_id', storeId)
      .maybeSingle();

    if (nonceLookupError) {
      console.error('[shopify-oauth] Nonce lookup failed:', nonceLookupError);
      return res.status(500).json({ error: 'Failed to verify OAuth nonce' });
    }

    if (storedNonce) {
      // Delete-after-use — single-use regardless of validity, so a replayed
      // callback (nonce reuse) can never succeed twice.
      await supabase.from('oauth_nonces').delete().eq('nonce', nonce);
    }

    if (!storedNonce || new Date(storedNonce.expires_at) < new Date()) {
      console.error('[shopify-oauth] Nonce missing, reused, or expired for', shop);
      return res.status(400).json({ error: 'OAuth nonce invalid or expired' });
    }

    // Exchange code for permanent access token
    try {
      const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: store.client_id,
          client_secret: store.client_secret,
          code,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error('[shopify-oauth] Token exchange failed:', err);
        return res.redirect('/?error=token_exchange_failed');
      }

      const { access_token } = await tokenRes.json();
      if (!access_token) return res.redirect('/?error=no_token');

      // Save token to store
      await supabase.from('stores')
        .update({ admin_token: access_token })
        .eq('id', storeId);

      // Pipeline log
      await supabase.from('pipeline_log').insert({
        store_id: storeId,
        agent: 'AUTH',
        message: `Shopify Admin connected for ${shop}`,
        level: 'success',
        metadata: { shop, scopes: SCOPES },
        user_id: null, initiator: 'user',
      });

      return res.redirect('/?tab=Shopify&connected=true');
    } catch (err) {
      console.error('[shopify-oauth] Error during token exchange:', err);
      return res.redirect('/?error=exchange_error');
    }
  }

  return res.status(400).json({ error: 'Provide store_id to connect or code for callback.' });
}
