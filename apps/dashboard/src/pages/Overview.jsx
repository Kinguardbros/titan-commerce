import { useState } from 'react';
import { useProposals } from '../hooks/useProposals';
import { approveProposal, rejectProposal, approveAllProposals, scanEvents } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import ProposalCard from '../components/ProposalCard';
import ApprovalQueue from '../components/ApprovalQueue';
import ShopifyServices from '../components/ShopifyServices';
import TerminalLog from '../components/TerminalLog';
import MetaPanel from '../components/MetaPanel';
import './Overview.css';

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const SEVERITY_LABELS = { critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium', low: '🟢 Low' };

export default function Overview({ onNavigateToProduct, onNavigateToStudio, onNavigateToShopify, storeId }) {
  const toast = useToast();
  const { proposals, loading, refresh } = useProposals(storeId);
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    toast.info('Scanning for events...');
    try {
      const result = await scanEvents(storeId);
      toast.success(`Found ${result.events_created} events, ${result.proposals_created} proposals`);
      refresh();
    } catch (err) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const handleApprove = async (id) => {
    try {
      const result = await approveProposal(id);
      toast.success(result.message || 'Proposal executed!');
      refresh();
    } catch (err) {
      toast.error(`Approve failed: ${err.message}`);
    }
  };

  const handleDismiss = async (id) => {
    try {
      await rejectProposal(id, 'Dismissed by user');
      toast.success('Proposal dismissed');
      refresh();
    } catch (err) {
      toast.error(`Dismiss failed: ${err.message}`);
    }
  };

  const handleApproveAll = async () => {
    const ids = proposals.map((p) => p.id);
    if (!ids.length) return;
    toast.info(`Executing ${ids.length} proposals...`);
    try {
      const result = await approveAllProposals(ids);
      toast.success(`${result.executed} proposals executed!`);
      refresh();
    } catch (err) {
      toast.error(`Bulk approve failed: ${err.message}`);
    }
  };

  const sorted = [...proposals].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.event?.severity || 'medium'] ?? 2;
    const sb = SEVERITY_ORDER[b.event?.severity || 'medium'] ?? 2;
    return sa - sb;
  });

  const grouped = {};
  for (const p of sorted) {
    const sev = p.event?.severity || 'medium';
    if (!grouped[sev]) grouped[sev] = [];
    grouped[sev].push(p);
  }

  return (
    <div className="overview">
      <div className="overview-header">
        <div className="overview-title gradient-heading">Overview</div>
        <div className="overview-actions">
          <button className="ov-scan-btn" onClick={handleScan} disabled={scanning}>
            {scanning ? 'Scanning...' : '🔍 Scan Now'}
          </button>
        </div>
      </div>

      {/* Proposal Queue */}
      {loading ? (
        <div className="ov-loading">Loading proposals...</div>
      ) : proposals.length > 0 ? (
        <div className="ov-proposals">
          <div className="ov-proposals-header">
            <div className="ov-proposals-title">{proposals.length} proposal{proposals.length !== 1 ? 's' : ''} awaiting approval</div>
            <button className="ov-approve-all-btn" onClick={handleApproveAll}>Approve All</button>
          </div>

          {Object.entries(grouped).map(([severity, items]) => (
            <div key={severity} className="ov-severity-group">
              <div className="ov-severity-label">{SEVERITY_LABELS[severity] || severity}</div>
              {items.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  onApprove={handleApprove}
                  onDismiss={handleDismiss}
                  onNavigate={onNavigateToStudio}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="ov-empty">
          <div className="ov-empty-text">No pending proposals</div>
          <div className="ov-empty-hint">Click "Scan Now" to detect events, or wait for the automated scan.</div>
        </div>
      )}

      {/* Pipeline */}
      <div className="ov-pipeline-section">
        <ApprovalQueue storeId={storeId} />
      </div>

      <div className="overview-bottom">
        <TerminalLog storeId={storeId} />
        <MetaPanel />
      </div>

      <div className="ov-services-section">
        <div className="ov-services-title gradient-heading">Services</div>
        <ShopifyServices onSwitchTab={(action) => {
          if (action === 'pricing') onNavigateToShopify?.();
          else if (action === 'dashboard') onNavigateToShopify?.();
        }} />
      </div>
    </div>
  );
}
