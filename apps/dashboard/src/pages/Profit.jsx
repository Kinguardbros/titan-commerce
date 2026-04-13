import { useState, useEffect, useCallback } from 'react';
import { useProfit } from '../hooks/useProfit';
import { getAllProducts, updateCogs, addManualAdspend, cleanupStaleCreatives } from '../lib/api';
import Tooltip from '../components/Tooltip';
import { SkeletonKPI, SkeletonRow } from '../components/Skeleton';
import { useToast } from '../hooks/useToast.jsx';
import './Profit.css';

const PERIODS = [
  { key: 7, label: '7 days' },
  { key: 14, label: '14 days' },
  { key: 30, label: '30 days' },
];

export default function Profit({ storeId, store }) {
  const toast = useToast();
  const [days, setDays] = useState(7);
  const { data, loading, refresh } = useProfit(days, storeId);
  const [products, setProducts] = useState([]);
  const [showCogs, setShowCogs] = useState(false);
  const [editingCogs, setEditingCogs] = useState(null);
  const [cogsValue, setCogsValue] = useState('');
  const [showAdspend, setShowAdspend] = useState(false);
  const [adspendDate, setAdspendDate] = useState(new Date().toISOString().split('T')[0]);
  const [adspendChannel, setAdspendChannel] = useState('tiktok');
  const [adspendAmount, setAdspendAmount] = useState('');
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);

  useEffect(() => {
    getAllProducts(storeId).then(setProducts).catch(() => {});
  }, []);

  const handleSaveCogs = async () => {
    if (!editingCogs || !cogsValue) return;
    await updateCogs(editingCogs, parseFloat(cogsValue));
    setEditingCogs(null);
    setCogsValue('');
    toast.success('COGS updated!');
    refresh();
  };

  const handleSaveAdspend = async () => {
    if (!adspendDate || !adspendAmount) return;
    await addManualAdspend(adspendDate, adspendChannel, parseFloat(adspendAmount));
    setAdspendAmount('');
    toast.success('Adspend saved!');
    refresh();
  };

  const handleExportCSV = () => {
    if (!data?.daily) return;
    const headers = 'Date,Revenue,Returns,COGS,Shipping,Meta Adspend,TikTok,Pinterest,Fees,Profit,ROAS,Profit %';
    const rows = data.daily.map((d) =>
      `${d.date},${d.revenue},${d.returns},${d.cogs},${d.shipping},${d.adspend_meta},${d.adspend_tiktok},${d.adspend_pinterest},${d.transaction_fees},${d.profit},${d.roas},${d.profit_pct}%`
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit_${days}d_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    toast.success('CSV downloaded!');
  };

  const t = data?.totals || {};
  const missingCogs = data?.missing_cogs || 0;

  return (
    <div className="profit-page">
      <div className="profit-header">
        <div className="profit-title">Profit & Loss</div>
        <div className="profit-controls">
          <div className="profit-periods">
            {PERIODS.map((p) => (
              <button key={p.key} className={`profit-period${days === p.key ? ' profit-period--active' : ''}`} onClick={() => setDays(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="profit-export" onClick={handleExportCSV}>Export CSV</button>
        </div>
      </div>

      {loading ? (
        <div className="profit-loading-skel">
          <div className="profit-kpis">{Array.from({ length: 5 }).map((_, i) => <SkeletonKPI key={i} />)}</div>
          <div style={{ marginTop: 16 }}><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
        </div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="profit-kpis">
            <div className="profit-kpi">
              <div className="profit-kpi-label">Revenue</div>
              <div className="profit-kpi-value">${t.revenue?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label">Returns</div>
              <div className="profit-kpi-value profit-kpi--red">${t.returns?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="profit-kpi-sub">{t.revenue > 0 ? ((t.returns / t.revenue) * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label"><Tooltip text="Cost of Goods Sold — your purchase price per unit">COGS</Tooltip></div>
              <div className="profit-kpi-value">${t.cogs?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="profit-kpi-sub">{t.revenue > 0 ? ((t.cogs / t.revenue) * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label">Shipping</div>
              <div className="profit-kpi-value">${t.shipping?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="profit-kpi-sub">{t.revenue > 0 ? ((t.shipping / t.revenue) * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label">Adspend</div>
              <div className="profit-kpi-value">${t.adspend_total?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <div className="profit-kpi-sub">{t.revenue > 0 ? ((t.adspend_total / t.revenue) * 100).toFixed(1) : 0}%</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label">Profit</div>
              <div className={`profit-kpi-value ${t.profit >= 0 ? 'profit-kpi--green' : 'profit-kpi--red'}`}>
                ${t.profit?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="profit-kpi-sub">{t.profit_pct?.toFixed(1)}%</div>
            </div>
            <div className="profit-kpi">
              <div className="profit-kpi-label"><Tooltip text="Return on Ad Spend — revenue divided by ad spend">ROAS</Tooltip></div>
              <div className="profit-kpi-value">{t.roas?.toFixed(2) || '—'}×</div>
            </div>
          </div>

          {missingCogs > 0 && (
            <div className="profit-warning">
              {missingCogs} products missing COGS — profit calculation may be inaccurate.
              <button className="profit-warning-btn" onClick={() => setShowCogs(true)}>Set COGS</button>
            </div>
          )}

          {/* Accuracy indicators */}
          <div className="profit-accuracy">
            <span className={`profit-accuracy-item ${data?.accuracy?.shipping ? 'profit-accuracy--ok' : 'profit-accuracy--warn'}`}>
              {data?.accuracy?.shipping ? 'Shipping: Tracked' : 'Shipping: Not available'}
            </span>
            <span className={`profit-accuracy-item ${data?.accuracy?.returns ? 'profit-accuracy--ok' : 'profit-accuracy--warn'}`}>
              {data?.accuracy?.returns ? 'Returns: Tracked' : 'Returns: Not tracked'}
            </span>
            <span className={`profit-accuracy-item ${data?.accuracy?.per_gateway_fees ? 'profit-accuracy--ok' : 'profit-accuracy--warn'}`}>
              {data?.accuracy?.per_gateway_fees ? 'Fees: Per-gateway' : 'Fees: Flat rate'}
            </span>
          </div>

          {/* Daily P&L table */}
          <div className="profit-table-wrap">
            <table className="profit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Revenue</th>
                  <th>Returns</th>
                  <th>COGS</th>
                  <th>Shipping</th>
                  <th>Meta</th>
                  <th>TikTok</th>
                  <th>Pinterest</th>
                  <th>Fees</th>
                  <th>Profit</th>
                  <th>ROAS</th>
                  <th>%</th>
                </tr>
              </thead>
              <tbody>
                {(data?.daily || []).map((d) => (
                  <tr key={d.date}>
                    <td className="profit-td-date">{d.date}</td>
                    <td>${d.revenue?.toFixed(2)}</td>
                    <td className="profit-td--red">${d.returns?.toFixed(2)}</td>
                    <td>${d.cogs?.toFixed(2)}</td>
                    <td>${d.shipping?.toFixed(2)}</td>
                    <td>${d.adspend_meta?.toFixed(2)}</td>
                    <td>${d.adspend_tiktok?.toFixed(2)}</td>
                    <td>${d.adspend_pinterest?.toFixed(2)}</td>
                    <td>${d.transaction_fees?.toFixed(2)}</td>
                    <td className={d.profit >= 0 ? 'profit-td--green' : 'profit-td--red'}>${d.profit?.toFixed(2)}</td>
                    <td>{d.roas?.toFixed(2)}×</td>
                    <td>{d.profit_pct?.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>TOTAL</td>
                  <td>${t.revenue?.toFixed(2)}</td>
                  <td className="profit-td--red">${t.returns?.toFixed(2)}</td>
                  <td>${t.cogs?.toFixed(2)}</td>
                  <td>${t.shipping?.toFixed(2)}</td>
                  <td>${t.adspend_meta?.toFixed(2)}</td>
                  <td>${t.adspend_tiktok?.toFixed(2)}</td>
                  <td>${t.adspend_pinterest?.toFixed(2)}</td>
                  <td>${t.transaction_fees?.toFixed(2)}</td>
                  <td className={t.profit >= 0 ? 'profit-td--green' : 'profit-td--red'}>${t.profit?.toFixed(2)}</td>
                  <td>{t.roas?.toFixed(2)}×</td>
                  <td>{t.profit_pct?.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bottom panels */}
          <div className="profit-bottom">
            {/* COGS Management */}
            <div className="profit-panel">
              <div className="profit-panel-header" onClick={() => setShowCogs(!showCogs)}>
                COGS Management {missingCogs > 0 && <span className="profit-badge-warn">⚠ {missingCogs} missing</span>}
              </div>
              {showCogs && (
                <div className="profit-panel-body">
                  {products.map((p) => (
                    <div key={p.id} className="profit-cogs-row">
                      <span className="profit-cogs-name">{p.title}</span>
                      {editingCogs === p.id ? (
                        <div className="profit-cogs-edit">
                          <input type="number" step="0.01" value={cogsValue} onChange={(e) => setCogsValue(e.target.value)} className="profit-cogs-input" placeholder="0.00" autoFocus />
                          <button className="profit-cogs-save" onClick={handleSaveCogs}>Save</button>
                          <button className="profit-cogs-cancel" onClick={() => setEditingCogs(null)}>✕</button>
                        </div>
                      ) : (
                        <button className="profit-cogs-btn" onClick={() => { setEditingCogs(p.id); setCogsValue(p.cogs || ''); }}>
                          {p.cogs ? `$${p.cogs}` : 'Set'}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manual Adspend */}
            <div className="profit-panel">
              <div className="profit-panel-header" onClick={() => setShowAdspend(!showAdspend)}>
                Manual Adspend (TikTok / Pinterest)
              </div>
              {showAdspend && (
                <div className="profit-panel-body">
                  <div className="profit-adspend-form">
                    <input type="date" value={adspendDate} onChange={(e) => setAdspendDate(e.target.value)} className="profit-adspend-input" />
                    <select value={adspendChannel} onChange={(e) => setAdspendChannel(e.target.value)} className="profit-adspend-select">
                      <option value="tiktok">TikTok</option>
                      <option value="pinterest">Pinterest</option>
                      <option value="other">Other</option>
                    </select>
                    <input type="number" step="0.01" value={adspendAmount} onChange={(e) => setAdspendAmount(e.target.value)} className="profit-adspend-input" placeholder="Amount" />
                    <button className="profit-adspend-save" onClick={handleSaveAdspend}>Add</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Storage cleanup */}
          <div className="profit-cleanup">
            <button
              className="profit-cleanup-btn"
              onClick={async () => {
                setCleaning(true);
                setCleanResult(null);
                try {
                  const result = await cleanupStaleCreatives();
                  setCleanResult(`Deleted ${result.deleted} stale creatives (checked ${result.total_checked})`);
                  toast.success(`Deleted ${result.deleted} stale creatives`);
                } catch (err) {
                  setCleanResult('Cleanup failed: ' + err.message);
                  toast.error(`Cleanup failed: ${err.message}`);
                } finally {
                  setCleaning(false);
                }
              }}
              disabled={cleaning}
            >
              {cleaning ? 'Cleaning...' : 'Clean Storage'}
            </button>
            <span className="profit-cleanup-hint">Removes pending creatives older than 7 days from storage</span>
            {cleanResult && <span className="profit-cleanup-result">{cleanResult}</span>}
          </div>
        </>
      )}
    </div>
  );
}
