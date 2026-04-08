import { isConnected, getAccountInsights, getCampaigns, getActiveAdsCount } from '../../lib/meta-api.js';
import { withAuth } from '../../lib/auth.js';

async function handler(req, res) {
  if (!isConnected()) {
    return res.status(200).json({ connected: false });
  }

  try {
    if (req.method === 'GET') {
      const [insights, campaigns, activeAds] = await Promise.all([
        getAccountInsights('last_7d'),
        getCampaigns(),
        getActiveAdsCount(),
      ]);

      return res.status(200).json({
        connected: true,
        insights,
        campaigns,
        active_ads: activeAds,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[meta/overview] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch Meta data', details: err.message });
  }
}

export default withAuth(handler);
