import './ProposalCard.css';

const SEVERITY_COLORS = {
  critical: 'var(--accent-danger)',
  high: 'var(--accent-secondary)',
  medium: 'var(--accent-tertiary)',
  low: 'var(--accent-success)',
};

const TYPE_ICONS = {
  generate_creatives: '🎨',
  optimize_listing: '✨',
  try_different_style: '🔄',
  generate_variations: '📈',
  pause_ad: '⏸',
  scale_ad: '🚀',
  restock_alert: '📦',
};

export default function ProposalCard({ proposal, onApprove, onDismiss, onNavigate }) {
  const severity = proposal.event?.severity || 'medium';
  const icon = TYPE_ICONS[proposal.type] || '📋';
  const action = typeof proposal.suggested_action === 'string'
    ? JSON.parse(proposal.suggested_action)
    : proposal.suggested_action;

  return (
    <div className={`pc pc--${severity}`}>
      <div className="pc-icon">{icon}</div>
      <div className="pc-body">
        <div className="pc-title">{proposal.title}</div>
        {proposal.description && <div className="pc-desc">{proposal.description}</div>}
        {action?.styles && (
          <div className="pc-tags">
            {action.styles.map((s) => <span key={s} className="pc-tag">{s}</span>)}
            {action.count && <span className="pc-tag pc-tag--count">{action.count}×</span>}
          </div>
        )}
        {proposal.product?.title && (
          <button className="pc-product-link" onClick={() => onNavigate?.(proposal.product_id)}>
            {proposal.product.title}
          </button>
        )}
      </div>
      <div className="pc-actions">
        <button className="pc-btn pc-btn--approve" onClick={() => onApprove(proposal.id)}>Approve</button>
        <button className="pc-btn pc-btn--dismiss" onClick={() => onDismiss(proposal.id)}>Dismiss</button>
      </div>
    </div>
  );
}
