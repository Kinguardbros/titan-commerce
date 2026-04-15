import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const WEBHOOK_TOPICS = ['products/create', 'products/update', 'products/delete'];

function webhookAddress() {
  const base = process.env.APP_URL || '';
  return `${base.replace(/\/$/, '')}/api/webhooks/shopify`;
}

/**
 * POST: Register 3 product webhooks for a store.
 * Idempotent — skips topics that already point at our endpoint.
 */
export async function register_webhooks(req, res) {
  const { store_id } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin_token' });

  const address = webhookAddress();
  if (!address.startsWith('http')) return res.status(500).json({ error: 'APP_URL not configured' });

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const existing = await client.listWebhooks();
  const existingMap = new Map(existing.map((w) => [w.topic, w]));

  const results = [];
  for (const topic of WEBHOOK_TOPICS) {
    const hit = existingMap.get(topic);
    if (hit && hit.address === address) {
      results.push({ topic, status: 'exists', id: hit.id });
      continue;
    }
    const resp = await client.registerWebhook(topic, address);
    if (resp?.webhook?.id) {
      results.push({ topic, status: 'registered', id: resp.webhook.id });
    } else {
      results.push({ topic, status: 'failed' });
    }
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SCRAPER', level: 'info',
    message: `Webhooks registered for ${store.name} (${WEBHOOK_TOPICS.length} topics)`,
    metadata: { address, results },
  });

  return res.status(200).json({ address, results });
}

/**
 * GET: List all webhooks currently registered in Shopify for a store.
 */
export async function list_webhooks(req, res) {
  const store_id = req.query.store_id;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin_token' });

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const webhooks = await client.listWebhooks();
  const ours = webhooks.filter((w) => WEBHOOK_TOPICS.includes(w.topic) && w.address === webhookAddress());

  return res.status(200).json({ webhooks, ours_count: ours.length, topics: WEBHOOK_TOPICS });
}

/**
 * POST: Unregister all product webhooks that point to our endpoint.
 */
export async function unregister_webhooks(req, res) {
  const { store_id } = req.body || {};
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store?.admin_token) return res.status(400).json({ error: 'Store has no admin_token' });

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const existing = await client.listWebhooks();
  const address = webhookAddress();
  const ours = existing.filter((w) => WEBHOOK_TOPICS.includes(w.topic) && w.address === address);

  const deleted = [];
  for (const w of ours) {
    await client.deleteWebhook(w.id);
    deleted.push({ id: w.id, topic: w.topic });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'SCRAPER', level: 'info',
    message: `Webhooks unregistered for ${store.name} (${deleted.length} removed)`,
    metadata: { deleted },
  });

  return res.status(200).json({ deleted });
}
