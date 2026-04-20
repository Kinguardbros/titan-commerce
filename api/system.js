import { withAuth } from '../lib/auth.js';

// GET actions
import { stores_list } from '../lib/actions/stores.js';
import { pipeline_log } from '../lib/actions/pipeline.js';
import { kpi, meta_overview, insights } from '../lib/actions/analytics.js';
import { profit_summary } from '../lib/actions/profit.js';
import { proposals_list, approve_proposal, reject_proposal, approve_all_proposals, scan_events } from '../lib/actions/proposals.js';
import { pending_optimizations, optimize_product, approve_optimization, reject_optimization, save_optimization } from '../lib/actions/optimizations.js';
import { get_skills, generate_skills, regenerate_skill } from '../lib/actions/skills.js';
import { read_size_chart, refresh_size_charts, save_size_chart, parse_size_chart_image } from '../lib/actions/size-chart.js';
import { product_detail, scrape_product, import_confirm, update_product_full, bulk_price } from '../lib/actions/products.js';
import { store_docs, store_docs_download, upload_store_doc, process_single_file, process_inbox } from '../lib/actions/docs.js';
import { custom_styles, analyze_style, create_custom_style, delete_custom_style, describe_style, scrape_style } from '../lib/actions/custom-styles.js';
import { update_creative, generate_branded, push_creative_to_shopify, cleanup_stale, poll_generations } from '../lib/actions/creatives.js';
import { update_cogs, manual_adspend } from '../lib/actions/pricing.js';
import { persona_avatars, generate_avatar, upload_avatar, set_avatar_reference, delete_avatar } from '../lib/actions/avatars.js';
import { sync_products } from '../lib/actions/sync.js';
import { register_webhooks, list_webhooks, unregister_webhooks } from '../lib/actions/webhooks.js';

const GET_ACTIONS = {
  stores_list,
  pipeline_log,
  kpi,
  profit_summary,
  pending_optimizations,
  insights,
  proposals_list,
  read_size_chart,
  product_detail,
  store_docs,
  store_docs_download,
  get_skills,
  meta_overview,
  refresh_size_charts,
  custom_styles,
  persona_avatars,
  list_webhooks,
  poll_generations,
};

const POST_ACTIONS = {
  update_creative,
  update_cogs,
  manual_adspend,
  optimize_product,
  approve_optimization,
  reject_optimization,
  save_optimization,
  generate_branded,
  approve_proposal,
  reject_proposal,
  approve_all_proposals,
  scan_events,
  bulk_price,
  cleanup_stale,
  generate_skills,
  regenerate_skill,
  upload_store_doc,
  process_single_file,
  process_inbox,
  push_creative_to_shopify,
  save_size_chart,
  parse_size_chart_image,
  update_product_full,
  scrape_product,
  import_confirm,
  analyze_style,
  create_custom_style,
  delete_custom_style,
  describe_style,
  scrape_style,
  generate_avatar,
  upload_avatar,
  set_avatar_reference,
  delete_avatar,
  sync_products,
  register_webhooks,
  unregister_webhooks,
};

async function handler(req, res) {
  const action = req.query.action || req.body?.action;
  if (!action) return res.status(400).json({ error: 'action required' });

  try {
    if (req.method === 'GET') {
      const fn = GET_ACTIONS[action];
      if (!fn) return res.status(400).json({ error: `Unknown GET action: ${action}` });
      return await fn(req, res);
    }
    if (req.method === 'POST') {
      const fn = POST_ACTIONS[action];
      if (!fn) return res.status(400).json({ error: `Unknown POST action: ${action}` });
      return await fn(req, res);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(`[system/${action}] Error:`, err);
    // Sanitize: never expose raw error messages (could leak API keys, DB strings)
    const safeDetails = (err.message || '')
      .replace(/sk-[a-zA-Z0-9_-]+/g, 'sk-***')
      .replace(/key[=:\s]+\S+/gi, 'key=***')
      .replace(/postgres:\/\/\S+/g, 'postgres://***')
      .slice(0, 200);
    return res.status(500).json({ error: `Action '${action}' failed`, details: safeDetails });
  }
}

export default withAuth(handler);
