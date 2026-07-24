import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { createShopifyClient } from '../shopify-admin.js';
import { rateLimit } from '../rate-limit.js';
import { hasPermission, hasStoreAccess } from '../permissions.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HARD_CAP = 500;

const PUBLISHABLE_UNPUBLISH = `
mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
  publishableUnpublish(id: $id, input: $input) {
    publishable { availablePublicationsCount { count } }
    userErrors { field message }
  }
}`;

const PUBLISHABLE_PUBLISH = `
mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
  publishablePublish(id: $id, input: $input) {
    publishable { availablePublicationsCount { count } }
    userErrors { field message }
  }
}`;

async function runBulkPublicationChange({ req, res, mode }) {
  // mode = 'unlist' | 'list'
  const { store_id, product_shopify_ids } = req.body || {};
  if (!store_id || !Array.isArray(product_shopify_ids) || product_shopify_ids.length === 0) {
    return res.status(400).json({ error: 'store_id and product_shopify_ids[] required' });
  }
  if (!hasPermission(req.user, 'products:publications')) {
    return res.status(403).json({ error: 'forbidden', hint: 'requires products:publications permission' });
  }
  if (!hasStoreAccess(req.user, store_id)) {
    return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  }
  if (product_shopify_ids.length > HARD_CAP) {
    return res.status(413).json({ error: `Batch too large — max ${HARD_CAP} products per call` });
  }

  const store = await getStore(store_id);
  if (!store?.admin_token) {
    return res.status(400).json({
      error: 'Store has no admin token',
      hint: 'Publications require Shopify Admin API access.',
    });
  }
  if (!store.online_store_publication_id) {
    return res.status(400).json({
      error: 'Store missing online_store_publication_id',
      hint: 'Run scripts/backfill-publication-ids.mjs after reauthorizing the Shopify app.',
    });
  }

  if (!(await rateLimit(`bulk_publish:${store_id}`, 10, 60_000))) {
    return res.status(429).json({ error: 'Rate limit — max 10 bulk publication calls per minute per store' });
  }

  const client = createShopifyClient(store.shopify_url, store.admin_token);
  const started = Date.now();
  const failed = [];
  let updated = 0;

  const mutation = mode === 'unlist' ? PUBLISHABLE_UNPUBLISH : PUBLISHABLE_PUBLISH;
  const mutationField = mode === 'unlist' ? 'publishableUnpublish' : 'publishablePublish';
  const nextPubState = mode === 'unlist' ? false : true;

  for (const pid of product_shopify_ids) {
    try {
      // 1. Ensure product is ACTIVE (unhide from DRAFT; a no-op if already ACTIVE)
      const statusResp = await client.updateProductStatus(pid, 'active');
      if (statusResp === null) throw new Error('updateProductStatus returned null (auth?)');

      // 2. Publish / unpublish on the Online Store publication
      const gqlResp = await client.graphql(mutation, {
        id: `gid://shopify/Product/${pid}`,
        input: [{ publicationId: store.online_store_publication_id }],
      });
      const userErrors = gqlResp?.data?.[mutationField]?.userErrors || [];
      if (userErrors.length > 0) {
        throw new Error(userErrors.map((e) => e.message).join('; '));
      }
      if (gqlResp?.errors?.length) {
        throw new Error(gqlResp.errors.map((e) => e.message).join('; '));
      }

      // 3. Mirror into Supabase (idempotent — matches Shopify)
      await supabase.from('products').update({
        status: 'active',
        publication_online_store: nextPubState,
      }).eq('shopify_id', pid);

      updated += 1;
    } catch (err) {
      console.error(`[publications/${mode}] product ${pid} failed:`, err);
      failed.push({ id: pid, error: err.message || String(err) });
    }
  }

  await supabase.from('pipeline_log').insert({
    store_id,
    agent: 'PUBLISHER',
    level: failed.length > 0 ? 'warn' : 'info',
    message: `Bulk ${mode === 'unlist' ? 'unlisted' : 'listed'} ${updated}/${product_shopify_ids.length} products`,
    metadata: {
      mode,
      requested: product_shopify_ids.length,
      updated,
      failed_ids: failed.map((f) => f.id),
      duration_ms: Date.now() - started,
    },
  });

  return res.status(200).json({ success: true, updated, failed });
}

export async function bulk_make_unlisted(req, res) {
  return runBulkPublicationChange({ req, res, mode: 'unlist' });
}

export async function bulk_make_listed(req, res) {
  return runBulkPublicationChange({ req, res, mode: 'list' });
}
