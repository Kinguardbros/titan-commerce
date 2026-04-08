import { useMetaOverview } from '../hooks/useMetaOverview';
import './OverviewPanels.css';

export default function MetaPanel() {
  const { data, loading } = useMetaOverview();

  if (loading) return <div className="ov-panel"><div className="ov-panel-loading">Loading Meta...</div></div>;

  if (!data?.connected) {
    return (
      <div className="ov-panel">
        <div className="ov-panel-header">Meta Ads</div>
        <div className="ov-placeholder">
          <div className="ov-placeholder-text">Meta Ads not connected</div>
          <div className="ov-placeholder-hint">Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID env vars</div>
        </div>
      </div>
    );
  }

  const ins = data.insights;

  return (
    <div className="ov-panel">
      <div className="ov-panel-header">Meta Ads <span className="ov-period">Last 7 days</span></div>
      <div className="ov-kpis">
        <div className="ov-kpi">
          <div className="ov-kpi-label">Spend</div>
          <div className="ov-kpi-value ov-kpi--gold">${ins?.spend?.toLocaleString() || '0'}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">ROAS</div>
          <div className="ov-kpi-value ov-kpi--emerald">{ins?.roas?.toFixed(1) || '0'}×</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">CTR</div>
          <div className="ov-kpi-value">{ins?.ctr?.toFixed(2) || '0'}%</div>
        </div>
      </div>
      <div className="ov-kpis">
        <div className="ov-kpi">
          <div className="ov-kpi-label">Revenue</div>
          <div className="ov-kpi-value">${ins?.revenue?.toLocaleString() || '0'}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">Conversions</div>
          <div className="ov-kpi-value">{ins?.conversions || 0}</div>
        </div>
        <div className="ov-kpi">
          <div className="ov-kpi-label">Active Ads</div>
          <div className="ov-kpi-value">{data.active_ads || 0}</div>
        </div>
      </div>

      {data.campaigns?.length > 0 && (
        <>
          <div className="ov-section-label">Campaigns</div>
          <div className="ov-list">
            {data.campaigns.map((c) => (
              <div key={c.id} className="ov-list-item">
                <span className={`ov-list-status ov-list-status--${c.status?.toLowerCase()}`}>{c.status}</span>
                <span className="ov-list-title">{c.name}</span>
                {c.daily_budget && <span className="ov-list-value">${c.daily_budget}/day</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
