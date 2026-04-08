import { getRevenueSummary, getRevenueDelta, getDailyRevenue, getTrafficSources, getTopProductsWithCreatives, getRecentOrders, isConnected, createShopifyClient } from '../../lib/shopify-admin.js';
import { getStore } from '../../lib/store-context.js';
import { withAuth } from '../../lib/auth.js';

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { store_id: storeId } = req.query;

  let client = null;
  if (storeId) {
    const store = await getStore(storeId);
    if (!store || !store.admin_token) {
      return res.status(200).json({ connected: false });
    }
    client = createShopifyClient(store.shopify_url, store.admin_token);
  }

  if (!client && !isConnected()) {
    return res.status(200).json({ connected: false });
  }

  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);

    let summary, deltas, daily, traffic, topProducts, orders;

    if (client) {
      // Store-specific client — call methods directly on the object
      const c = client;
      [summary, deltas, daily, traffic, topProducts, orders] = await Promise.all([
        c.getRevenueSummary(days), c.getRevenueDelta(days), c.getDailyRevenue(days),
        c.getTrafficSources(days), c.getTopProductsWithCreatives(days, 10), c.getRecentOrders(10),
      ]);
      // Extra data for dashboard — graceful fallback if scopes missing
      var topCustomers = [], paymentStatus = null, collectionCount = 0, customerCount = 0, productCount = 0;
      try {
        [topCustomers, paymentStatus, collectionCount, customerCount, productCount] = await Promise.all([
          c.getTopCustomers(days, 5).catch(() => []),
          c.getPaymentFulfillmentStatus(days).catch(() => null),
          c.getCollectionCount().catch(() => 0),
          c.getCustomerCount().catch(() => 0),
          c.getProductCount().catch(() => 0),
        ]);
      } catch (extraErr) {
        console.error('[shopify/overview] Extra data failed (scope issue?):', extraErr.message);
      }
    } else {
      [summary, deltas, daily, traffic, topProducts, orders] = await Promise.all([
        getRevenueSummary(days), getRevenueDelta(days), getDailyRevenue(days),
        getTrafficSources(days), getTopProductsWithCreatives(days, 10), getRecentOrders(10),
      ]);
      var topCustomers = [], paymentStatus = null, collectionCount = 0, customerCount = 0, productCount = 0;
    }

    return res.status(200).json({
      connected: true, days,
      ...summary, ...deltas,
      daily_revenue: daily, traffic_sources: traffic,
      top_products: topProducts, recent_orders: orders,
      top_customers: topCustomers, payment_status: paymentStatus,
      collection_count: collectionCount, customer_count: customerCount, product_count: productCount,
    });
  } catch (err) {
    console.error('[shopify/overview] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch Shopify data', details: err.message });
  }
}

export default withAuth(handler);
