import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import {
  handleProductCreate, handleProductUpdate, handleProductDelete,
} from '../../lib/shopify-webhook-handlers.js';

// Raw body required for HMAC verification — disable automatic JSON parsing
export const config = { api: { bodyParser: false } };

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

/**
 * Shopify webhook HMAC is base64-encoded (NOT hex like OAuth callback).
 * See api/auth/shopify.js:16-27 for the hex variant used in OAuth.
 */
export function verifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch (err) {
    console.error('[webhook] HMAC compare failed:', { error: err.message });
    return false;
  }
}

const HANDLERS = {
  'products/create': handleProductCreate,
  'products/update': handleProductUpdate,
  'products/delete': handleProductDelete,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const topic = req.headers['x-shopify-topic'];
  const shop = req.headers['x-shopify-shop-domain'];
  const hmac = req.headers['x-shopify-hmac-sha256'];
  const wId = req.headers['x-shopify-webhook-id'];

  const rawBody = await readRawBody(req);

  const { data: store } = await supabase
    .from('stores')
    .select('id, shopify_url, admin_token, client_secret')
    .eq('shopify_url', shop)
    .single();

  if (!store?.client_secret) {
    console.error('[webhook] Unknown shop or missing secret:', { shop, topic });
    return res.status(401).json({ error: 'unauthorized' });
  }

  if (!verifyHmac(rawBody, hmac, store.client_secret)) {
    console.error('[webhook] HMAC invalid:', { shop, topic, webhook_id: wId });
    return res.status(401).json({ error: 'hmac_invalid' });
  }

  const fn = HANDLERS[topic];
  if (!fn) {
    console.warn('[webhook] Unsupported topic (acked):', { topic });
    return res.status(200).json({ ok: true, ignored: topic });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    console.error('[webhook] Invalid JSON:', { error: err.message, shop, topic });
    return res.status(400).json({ error: 'invalid_json' });
  }

  try {
    const result = await fn(store, payload);
    const isCreate = result.action === 'created';
    const friendlyMessage = isCreate
      ? `New product imported: "${result.title || 'Unknown'}"`
      : result.action === 'updated'
      ? `Product updated: "${result.title || 'Unknown'}"`
      : `Product ${result.action} (shopify_id=${result.shopify_id})`;
    await supabase.from('pipeline_log').insert({
      store_id: store.id, agent: 'SCRAPER', level: isCreate ? 'success' : 'info',
      message: friendlyMessage,
      metadata: { topic, webhook_id: wId, ...result },
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] Handler error:', { topic, shop, error: err.message });
    return res.status(500).json({ error: 'handler_failed' });
  }
}
