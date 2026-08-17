import { withAuth } from '../lib/auth.js';

// GET actions
import { stores_list } from '../lib/actions/stores.js';
import { pipeline_log } from '../lib/actions/pipeline.js';
import { kpi, meta_overview, insights } from '../lib/actions/analytics.js';
import { profit_summary } from '../lib/actions/profit.js';
import { proposals_list, approve_proposal, reject_proposal, approve_all_proposals, scan_events } from '../lib/actions/proposals.js';
import { pending_optimizations, optimize_product, approve_optimization, reject_optimization, save_optimization } from '../lib/actions/optimizations.js';
import { get_skills, generate_skills, regenerate_skill, save_skill } from '../lib/actions/skills.js';
import { read_size_chart, refresh_size_charts, save_size_chart, parse_size_chart_image } from '../lib/actions/size-chart.js';
import { product_detail, scrape_product, import_confirm, update_product_full, bulk_price } from '../lib/actions/products.js';
import { store_docs, store_docs_download, upload_store_doc, process_single_file, process_inbox } from '../lib/actions/docs.js';
import { custom_styles, analyze_style, create_custom_style, delete_custom_style, describe_style, scrape_style } from '../lib/actions/custom-styles.js';
import { update_creative, generate_branded, push_creative_to_shopify, cleanup_stale, poll_generations } from '../lib/actions/creatives.js';
import { update_cogs, manual_adspend } from '../lib/actions/pricing.js';
import { persona_avatars, generate_avatar, poll_avatar_generations, upload_avatar, set_avatar_reference, set_avatar_active, delete_avatar } from '../lib/actions/avatars.js';
import { sync_products } from '../lib/actions/sync.js';
import { register_webhooks, list_webhooks, unregister_webhooks } from '../lib/actions/webhooks.js';
import { product_reviews_list, add_review_manual, update_review, delete_review, set_review_status, seed_reviews_helpful } from '../lib/actions/reviews.js';
import { import_reviews_csv } from '../lib/actions/reviews-import.js';
import { generate_reviews_ai } from '../lib/actions/reviews-ai.js';
import { upload_review_photo, delete_review_photo } from '../lib/actions/reviews-photo.js';
import { push_reviews_to_shopify, refresh_store_reviews_aggregate } from '../lib/actions/reviews-push.js';
import { submit_review_public, vote_review_helpful, review_helpful_counts } from '../lib/actions/reviews-public.js';
import { export_products_csv } from '../lib/actions/exports.js';
import { bulk_make_unlisted, bulk_make_listed } from '../lib/actions/publications.js';
import { scrape_amazon_preview, import_amazon_reviews, check_review_duplicates } from '../lib/actions/reviews-amazon.js';
import { me, users_list, create_user, update_user, delete_user, reset_password, generate_api_token, change_own_password } from '../lib/actions/users.js';

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
  poll_avatar_generations,
  list_webhooks,
  poll_generations,
  product_reviews_list,
  review_helpful_counts,
  users_list,
  me,
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
  save_skill,
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
  set_avatar_active,
  delete_avatar,
  sync_products,
  register_webhooks,
  unregister_webhooks,
  submit_review_public,
  vote_review_helpful,
  add_review_manual,
  update_review,
  delete_review,
  set_review_status,
  seed_reviews_helpful,
  import_reviews_csv,
  upload_review_photo,
  delete_review_photo,
  generate_reviews_ai,
  push_reviews_to_shopify,
  refresh_store_reviews_aggregate,
  scrape_amazon_preview,
  import_amazon_reviews,
  check_review_duplicates,
  export_products_csv,
  bulk_make_unlisted,
  bulk_make_listed,
  create_user,
  update_user,
  delete_user,
  reset_password,
  generate_api_token,
  change_own_password,
};

// Actions callable cross-origin need CORS headers — each maps to the specific
// origins it trusts (NOT a single shared allow-list). Storefront actions get the
// storefront's own domain(s); import_amazon_reviews gets Amazon's domain(s) only.
// Note: for the userscript's actual request, GM_xmlhttpRequest bypasses browser-side
// CORS enforcement entirely — the real authorization gate is the bearer api_token
// check in verifyAuth. This CORS entry exists for correctness/defense-in-depth (e.g.
// if a future integration calls this action via plain fetch() from a browser tab).
const STOREFRONT_ORIGINS = (process.env.STOREFRONT_URL || 'https://isolaswim.com,https://swimwear-brand.myshopify.com')
  .split(',').map((o) => o.trim()).filter(Boolean);
const AMAZON_USERSCRIPT_ORIGINS = (process.env.AMAZON_USERSCRIPT_ORIGINS || 'https://www.amazon.com,https://smile.amazon.com')
  .split(',').map((o) => o.trim()).filter(Boolean);

const CORS_ACTIONS = {
  submit_review_public: STOREFRONT_ORIGINS,
  vote_review_helpful: STOREFRONT_ORIGINS,
  review_helpful_counts: STOREFRONT_ORIGINS,
  import_amazon_reviews: AMAZON_USERSCRIPT_ORIGINS,
};

function applyCors(req, res, action) {
  const allowedOrigins = CORS_ACTIONS[action] || [];
  const origin = req.headers.origin;
  const allow = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function handler(req, res) {
  const action = req.query.action || req.body?.action;

  // CORS preflight for public storefront actions (must answer before auth/dispatch).
  if (req.method === 'OPTIONS') {
    if (CORS_ACTIONS[action]) { applyCors(req, res, action); return res.status(200).end(); }
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (CORS_ACTIONS[action]) applyCors(req, res, action);

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
