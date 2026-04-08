import { useShopifyOverview } from '../hooks/useShopifyOverview';
import './OverviewPanels.css';

export default function ShopifyPanel() {
  const { data, loading } = useShopifyOverview(7);

  if (loading) return <div className="ov-panel"><div className="ov-panel-loading">Loading Shopify...</div></div>;

  if (!data?.connected) {
    return (
      <div className="ov-panel">
        <div className="ov-panel-header">Shopify</div>
        <div className="ov-placeholder">
          <div className="ov-placeholder-text">Shopify Admin not connected</div>
          <div className="ov-placeholder-hint">Set SHOPIFY_ADMIN_TOKEN env var with read_orders scope</div>
        </div>
      </div>
    );
  }

  if (data?.scope_error) {
    return (
      <div className="ov-panel">
        <div className="ov-panel-header">Shopify</div>
        <div className="ov-placeholder">
          <div className="ov-placeholder-text">Missing permissions</div>
          <div className="ov-placeholder-hint">Admin token needs read_orders scope. Update the custom app in Shopify Admin → Settings → Apps.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="ov-panel">
      <div className="ov-panel-header">Shopify <span className="ov-period">Last 7 days</span></div>
      <div className="ov-kpis">
        <div className="ov-kpi">
          <div className="ov-kpi-label">Revenue</div>
          <div className="ov-kpi-value ov-kpi--emerald">${data.revenue?.toLocaleString()}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">Orders</div>
          <div className="ov-kpi-value">{data.orders}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">AOV</div>
          <div className="ov-kpi-value">${data.aov?.toFixed(2)}</div>
        </div>
      </div>

      {data.top_products?.length > 0 && (
        <>
          <div className="ov-section-label">Top Products</div>
          <div className="ov-list">
            {data.top_products.map((p, i) => (
              <div key={i} className="ov-list-item">
                <span className="ov-list-rank">{i + 1}</span>
                <span className="ov-list-title">{p.title}</span>
                <span className="ov-list-meta">{p.units} sold</span>
                <span className="ov-list-value">${p.revenue}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {data.recent_orders?.length > 0 && (
        <>
          <div className="ov-section-label">Recent Orders</div>
          <div className="ov-list">
            {data.recent_orders.map((o, i) => (
              <div key={i} className="ov-list-item">
                <span className="ov-list-title">{o.name}</span>
                <span className={`ov-list-status ov-list-status--${o.status?.toLowerCase()}`}>{o.status || 'pending'}</span>
                <span className="ov-list-value">${o.total?.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
