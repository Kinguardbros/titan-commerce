import { useState, useMemo } from 'react';
import { useShopifyOverview } from '../hooks/useShopifyOverview';
import { useProfit } from '../hooks/useProfit';
import { useInsights } from '../hooks/useInsights';
import { useProposals } from '../hooks/useProposals';
import { approveProposal, rejectProposal, approveAllProposals, scanEvents } from '../lib/api';
import ProposalCard from '../components/ProposalCard';
import TerminalLog from '../components/TerminalLog';
import { SkeletonKPI } from '../components/Skeleton';
import { useToast } from '../hooks/useToast.jsx';
import './Cockpit.css';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABELS = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

function KpiCard({ label, value, sub, accent }) {
  return (
    <div className="ck-kpi">
      <div className="ck-kpi-label">{label}</div>
      <div className={`ck-kpi-value${accent ? ` ck-kpi-value--${accent}` : ''}`}>{value}</div>
      {sub && <div className="ck-kpi-sub">{sub}</div>}
    </div>
  );
}

function PipelineBar({ label, count, total, color }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="ck-pipe-row">
      <div className="ck-pipe-label">{label}</div>
      <div className="ck-pipe-bar-wrap">
        <div className="ck-pipe-bar" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="ck-pipe-count">{count}</div>
    </div>
  );
}

export default function Cockpit({ storeId, store, onNavigateToProduct, onNavigateToStudio }) {
  const toast = useToast();
  const { data: shopify, loading: shopLoading } = useShopifyOverview(7, storeId);
  const { data: profit, loading: profitLoading } = useProfit(7, storeId);
  const { data: insights, loading: insightsLoading } = useInsights(storeId);
  const { proposals, loading: proposalsLoading, refresh: refreshProposals } = useProposals(storeId);
  const [scanning, setScanning] = useState(false);
  const [monthTarget] = useState(() => {
    try { return Number(localStorage.getItem(`ck_target_${storeId}`)) || 5000; } catch { return 5000; }
  });

  // Today's Pulse
  const revenue = shopify?.kpi?.total_revenue || 0;
  const orders = shopify?.kpi?.total_orders || 0;
  const avgOrder = orders > 0 ? (revenue / orders).toFixed(2) : '0';
  const profitVal = profit?.profit || 0;
  const margin = profit?.revenue > 0 ? Math.round((profitVal / profit.revenue) * 100) : 0;
  const currency = store?.currency === 'USD' ? '$' : '€';

  // Month progress (use 30d profit data as proxy)
  const monthRevenue = profit?.revenue || 0;
  const monthPct = monthTarget > 0 ? Math.min(100, Math.round((monthRevenue / monthTarget) * 100)) : 0;

  // Pipeline
  const pipe = insights?.pipeline_summary || {};
  const pipeTotal = (pipe.generating || 0) + (pipe.pending || 0) + (pipe.approved || 0) + (pipe.published || 0);

  // Top performers
  const topProducts = useMemo(() => (shopify?.top_products || []).slice(0, 5), [shopify]);

  // Proposals
  const sorted = useMemo(() => {
    return [...proposals].sort((a, b) => {
      const sa = SEVERITY_ORDER[a.event?.severity || 'medium'] ?? 2;
      const sb = SEVERITY_ORDER[b.event?.severity || 'medium'] ?? 2;
      return sa - sb;
    });
  }, [proposals]);

  const grouped = useMemo(() => {
    const g = {};
    for (const p of sorted) {
      const sev = p.event?.severity || 'medium';
      if (!g[sev]) g[sev] = [];
      g[sev].push(p);
    }
    return g;
  }, [sorted]);

  const handleApprove = async (id) => {
    try { const r = await approveProposal(id); toast.success(r.message || 'Done!'); refreshProposals(); } catch (e) { toast.error(e.message); }
  };
  const handleDismiss = async (id) => {
    try { await rejectProposal(id, 'Dismissed'); toast.success('Dismissed'); refreshProposals(); } catch (e) { toast.error(e.message); }
  };
  const handleApproveAll = async () => {
    const ids = proposals.map((p) => p.id);
    if (!ids.length) return;
    try { const r = await approveAllProposals(ids); toast.success(`${r.executed} executed`); refreshProposals(); } catch (e) { toast.error(e.message); }
  };
  const handleScan = async () => {
    setScanning(true);
    try { const r = await scanEvents(storeId); toast.success(`${r.events_created} events, ${r.proposals_created} proposals`); refreshProposals(); } catch (e) { toast.error(e.message); }
    setScanning(false);
  };

  const loading = shopLoading || profitLoading;

  return (
    <div className="ck">
      {/* ── TODAY'S PULSE ── */}
      <div className="ck-section-label">Today's Pulse</div>
      <div className="ck-kpi-grid">
        {loading ? (
          <>
            <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
          </>
        ) : (
          <>
            <KpiCard label="Revenue (7d)" value={`${currency}${revenue.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`${orders} orders`} />
            <KpiCard label="Avg Order" value={`${currency}${avgOrder}`} sub="per order" />
            <KpiCard label="Profit (7d)" value={`${currency}${profitVal.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} sub={`${margin}% margin`} accent={margin > 30 ? 'green' : margin > 15 ? 'yellow' : 'red'} />
            <KpiCard label="Creative Pipeline" value={pipeTotal} sub={`${pipe.pending || 0} pending review`} />
          </>
        )}
      </div>

      {/* ── MONTH PROGRESS ── */}
      <div className="ck-month">
        <div className="ck-month-head">
          <span className="ck-month-label">Month Revenue</span>
          <span className="ck-month-target">{monthPct}% of {currency}{monthTarget.toLocaleString()}</span>
        </div>
        <div className="ck-month-bar-wrap">
          <div className="ck-month-bar" style={{ width: `${monthPct}%` }} />
        </div>
      </div>

      {/* ── TWO COLUMN: TOP PERFORMERS + PIPELINE ── */}
      <div className="ck-columns">
        {/* Left: Top Performers */}
        <div className="ck-col">
          <div className="ck-section-label">Top Performers <span className="ck-section-sub">7 days</span></div>
          {topProducts.length === 0 && !shopLoading && (
            <div className="ck-empty-hint">No sales data yet</div>
          )}
          {topProducts.map((p, i) => (
            <div key={p.product_id || i} className="ck-top-row" onClick={() => onNavigateToProduct?.(p.product_id)}>
              <span className="ck-top-rank">{i + 1}</span>
              <span className="ck-top-name">{p.title}</span>
              <span className="ck-top-rev">{currency}{(p.revenue || 0).toLocaleString('en', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
              <span className="ck-top-units">{p.units || 0} sold</span>
            </div>
          ))}
        </div>

        {/* Right: Creative Pipeline */}
        <div className="ck-col">
          <div className="ck-section-label">Creative Pipeline</div>
          {insightsLoading ? (
            <div className="ck-empty-hint">Loading...</div>
          ) : (
            <>
              <PipelineBar label="Generating" count={pipe.generating || 0} total={pipeTotal || 1} color="var(--gold, #d4a853)" />
              <PipelineBar label="Pending" count={pipe.pending || 0} total={pipeTotal || 1} color="#f59e0b" />
              <PipelineBar label="Approved" count={pipe.approved || 0} total={pipeTotal || 1} color="#22c55e" />
              <PipelineBar label="Published" count={pipe.published || 0} total={pipeTotal || 1} color="#3b82f6" />
              {(pipe.failed || 0) > 0 && (
                <PipelineBar label="Failed" count={pipe.failed} total={pipeTotal || 1} color="#ef4444" />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── PROPOSALS ── */}
      <div className="ck-section">
        <div className="ck-section-head">
          <div className="ck-section-label">
            Proposals
            {proposals.length > 0 && <span className="ck-badge">{proposals.length}</span>}
          </div>
          <div className="ck-section-actions">
            {proposals.length > 1 && <button className="ck-btn ck-btn--sm" onClick={handleApproveAll}>Approve All</button>}
            <button className="ck-btn ck-btn--sm ck-btn--muted" onClick={handleScan} disabled={scanning}>{scanning ? '...' : 'Scan Now'}</button>
          </div>
        </div>
        {proposalsLoading ? (
          <div className="ck-empty-hint">Loading...</div>
        ) : proposals.length === 0 ? (
          <div className="ck-empty-hint">All caught up — no pending proposals</div>
        ) : (
          Object.entries(grouped).map(([severity, items]) => (
            <div key={severity} className="ck-proposal-group">
              <div className="ck-proposal-sev">{SEVERITY_LABELS[severity] || severity}</div>
              {items.map((p) => (
                <ProposalCard key={p.id} proposal={p} onApprove={handleApprove} onDismiss={handleDismiss} onNavigate={onNavigateToStudio} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* ── PIPELINE LOG ── */}
      <div className="ck-section">
        <div className="ck-section-label">Pipeline Log</div>
        <TerminalLog storeId={storeId} />
      </div>
    </div>
  );
}
