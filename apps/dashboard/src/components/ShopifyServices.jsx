import './ShopifyServices.css';

const SERVICES = [
  {
    category: 'Store Management', icon: '🏪', desc: 'Overview, audits, and optimization',
    actions: [
      { label: 'Store Overview', desc: 'Product count, orders & issues', action: 'dashboard', active: true },
      { label: 'Product Health Audit', desc: 'Missing images, descriptions & pricing', action: 'audit', active: true },
      { label: 'Store Optimization', desc: 'Improvements across SEO, pricing & content', action: null, active: false },
    ],
  },
  {
    category: 'Content & Copy', icon: '✏️', desc: 'Product copy, SEO meta, and blog posts',
    actions: [
      { label: 'Optimize Product Titles', desc: 'SEO-optimized titles for every product', action: 'optimize', active: true },
      { label: 'Write Descriptions', desc: 'Compelling, benefit-focused product copy', action: 'optimize', active: true },
      { label: 'Generate SEO Meta', desc: 'Optimized titles & meta descriptions', action: 'optimize', active: true },
      { label: 'Write Blog Post', desc: 'Create and publish a blog post', action: null, active: false },
    ],
  },
  {
    category: 'Analytics & Reports', icon: '📊', desc: 'Sales analysis, forecasts, and segments',
    actions: [
      { label: 'Sales Performance', desc: 'Revenue & top products (30 days)', action: 'dashboard', active: true },
      { label: 'Top / Bottom Products', desc: 'Rank products by performance', action: 'dashboard', active: true },
      { label: 'Customer Segmentation', desc: 'VIPs, at-risk, and spending tiers', action: null, active: false },
      { label: 'Inventory Forecast', desc: 'Predict stock-outs in 30 days', action: null, active: false },
    ],
  },
  {
    category: 'Trends & Research', icon: '🔥', desc: 'Market trends, niches, and competitor intel',
    actions: [
      { label: 'Trending Niches', desc: 'Top trending product niches right now', action: null, active: false },
      { label: 'Competitor Research', desc: 'Pricing, range & marketing strategies', action: null, active: false },
      { label: 'Evaluate Opportunity', desc: 'Trends, volume & competition analysis', action: null, active: false },
    ],
  },
  {
    category: 'Orders & Customers', icon: '📦', desc: 'Order status, refunds, and fulfillment',
    actions: [
      { label: 'Check Order Status', desc: 'Look up any order by number or email', action: null, active: false },
      { label: 'Process Refund', desc: 'Calculate and process a refund', action: null, active: false },
      { label: 'Fulfill Order', desc: 'Add tracking and mark as fulfilled', action: null, active: false },
    ],
  },
  {
    category: 'Inventory & Pricing', icon: '💰', desc: 'Stock levels, pricing, and discounts',
    actions: [
      { label: 'Low Stock Audit', desc: 'Products below 10 units + reorder', action: null, active: false },
      { label: 'Bulk Update Pricing', desc: 'Apply % increase/decrease to collection', action: 'pricing', active: true },
      { label: 'Create Discount', desc: 'Discount codes or automatic promotions', action: null, active: false },
    ],
  },
];

export default function ShopifyServices({ onSwitchTab }) {
  return (
    <div className="ssv">
      <div className="ssv-grid">
        {SERVICES.map((cat) => (
          <div key={cat.category} className="ssv-card">
            <div className="ssv-card-header">
              <span className="ssv-card-icon">{cat.icon}</span>
              <div>
                <div className="ssv-card-title">{cat.category}</div>
                <div className="ssv-card-desc">{cat.desc}</div>
              </div>
            </div>
            <div className="ssv-actions">
              {cat.actions.map((a) => (
                <button
                  key={a.label}
                  className={`ssv-action${a.active ? '' : ' ssv-action--disabled'}`}
                  onClick={() => a.active && a.action && onSwitchTab(a.action)}
                  disabled={!a.active}
                >
                  <div className="ssv-action-label">{a.label}</div>
                  <div className="ssv-action-desc">{a.desc}</div>
                  {!a.active && <span className="ssv-action-badge">Coming Soon</span>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
