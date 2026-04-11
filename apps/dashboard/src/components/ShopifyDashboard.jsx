import { useState } from 'react';
import { useShopifyOverview } from '../hooks/useShopifyOverview';
import { SkeletonKPI, SkeletonChart, SkeletonRow } from './Skeleton';
import './ShopifyDashboard.css';

const PERIODS = [
  { key: 7, label: '7D' },
  { key: 30, label: '30D' },
  { key: 90, label: '90D' },
];

export default function ShopifyDashboard({ storeId, store, onNavigateToProduct }) {
  const [days, setDays] = useState(7);
  const { data, loading } = useShopifyOverview(days, storeId);

  if (loading) return (
    <div className="sdb">
      <div className="sdb-kpis">{Array.from({ length: 4 }).map((_, i) => <SkeletonKPI key={i} />)}</div>
      <SkeletonChart />
      <div style={{ marginTop: 16 }}><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
    </div>
  );
  if (!data?.connected) return (
    <div className="sdb-empty">
      <div className="sdb-empty-icon">🔌</div>
      <div className="sdb-empty-title">Shopify Admin not connected</div>
      <div className="sdb-empty-desc">Connect your Shopify Admin API to see orders, revenue, and analytics.</div>
      {store?.client_id && !store?.admin_token && (
        <a href={`/api/auth/shopify?store_id=${store.id}`} className="sdb-connect-btn">Connect Shopify Admin</a>
      )}
      {!store?.client_id && !store?.admin_token && (
        <div className="sdb-empty-hint">Contact admin to set up Shopify connection for this store.</div>
      )}
    </div>
  );

  const maxRev = Math.max(...(data.daily_revenue || []).map((d) => d.revenue), 1);
  const ps = data.payment_status;

  return (
    <div className="sdb">
      {/* KPI row */}
      <div className="sdb-kpis">
        <div className="sdb-kpi"><span className="sdb-kpi-icon">🛍</span><span className="sdb-kpi-val">{data.product_count || 0}</span><span className="sdb-kpi-label">Products</span></div>
        <div className="sdb-kpi"><span className="sdb-kpi-icon">📦</span><span className="sdb-kpi-val">{data.orders || 0}</span><span className="sdb-kpi-label">Orders</span></div>
        <div className="sdb-kpi"><span className="sdb-kpi-icon">👥</span><span className="sdb-kpi-val">{data.customer_count || 0}</span><span className="sdb-kpi-label">Customers</span></div>
        <div className="sdb-kpi"><span className="sdb-kpi-icon">📂</span><span className="sdb-kpi-val">{data.collection_count || 0}</span><span className="sdb-kpi-label">Collections</span></div>
      </div>

      {/* Revenue chart */}
      <div className="sdb-revenue">
        <div className="sdb-revenue-header">
          <div>
            <div className="sdb-revenue-total">${data.revenue?.toLocaleString()}</div>
            <div className="sdb-revenue-meta">📦 {data.orders} orders · 💵 ${data.aov?.toFixed(0)} avg · 📈 ${(data.revenue / (days || 1)).toFixed(0)}/day</div>
          </div>
          <div className="sdb-periods">
            {PERIODS.map((p) => (
              <button key={p.key} className={`sdb-period${days === p.key ? ' sdb-period--active' : ''}`} onClick={() => setDays(p.key)}>{p.label}</button>
            ))}
          </div>
        </div>
        {data.daily_revenue?.length > 0 && (
          <div className="sdb-chart">
            {data.daily_revenue.map((d) => (
              <div key={d.date} className="sdb-bar-col">
                <div className="sdb-bar" style={{ height: `${(d.revenue / maxRev) * 100}%` }} />
                <div className="sdb-bar-label">{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom 3 columns */}
      <div className="sdb-bottom">
        {/* Payment/Fulfillment */}
        {ps && (
          <div className="sdb-card">
            <div className="sdb-card-title">Payment</div>
            {ps.payment?.map((s) => (
              <div key={s.status} className="sdb-stat-row">
                <span className={`sdb-dot sdb-dot--${s.status}`} />
                <span className="sdb-stat-label">{s.status.toUpperCase()}</span>
                <span className="sdb-stat-val">{s.count} ({s.pct}%)</span>
              </div>
            ))}
            <div className="sdb-card-title" style={{ marginTop: 12 }}>Fulfillment</div>
            {ps.fulfillment?.map((s) => (
              <div key={s.status} className="sdb-stat-row">
                <span className={`sdb-dot sdb-dot--${s.status}`} />
                <span className="sdb-stat-label">{s.status.toUpperCase()}</span>
                <span className="sdb-stat-val">{s.count} ({s.pct}%)</span>
              </div>
            ))}
          </div>
        )}

        {/* Top Products */}
        <div className="sdb-card">
          <div className="sdb-card-title">Top Products</div>
          {(data.top_products || []).slice(0, 5).map((p, i) => (
            <div key={i} className="sdb-list-row" onClick={() => p.product_id && onNavigateToProduct?.(p.product_id)} style={p.product_id ? { cursor: 'pointer' } : {}}>
              <span className="sdb-list-rank">{i + 1}.</span>
              <span className="sdb-list-name">{p.title?.split('|')[0]?.trim()}</span>
              <span className="sdb-list-val">${p.revenue}</span>
            </div>
          ))}
        </div>

        {/* Top Customers */}
        <div className="sdb-card">
          <div className="sdb-card-title">Top Customers</div>
          {(data.top_customers || []).map((c, i) => (
            <div key={i} className="sdb-list-row">
              <span className="sdb-list-rank">{i + 1}.</span>
              <span className="sdb-list-name">{c.name}</span>
              <span className="sdb-list-meta">{c.orders} ord</span>
              <span className="sdb-list-val">${c.total}</span>
            </div>
          ))}
          {(!data.top_customers || data.top_customers.length === 0) && <div className="sdb-list-empty">No customer data</div>}
        </div>
      </div>
    </div>
  );
}
