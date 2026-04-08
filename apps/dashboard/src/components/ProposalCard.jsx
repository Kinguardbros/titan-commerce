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
    <div className={`pc pc--${severity}`} role="article" aria-label={`Proposal: ${proposal.title}`}>
      <div className="pc-icon" aria-hidden="true">{icon}</div>
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
          <button className="pc-product-link" aria-label={`Go to product: ${proposal.product.title}`} onClick={() => onNavigate?.(proposal.product_id)}>
            {proposal.product.title}
          </button>
        )}
      </div>
      <div className="pc-actions">
        <button className="pc-btn pc-btn--approve" aria-label={`Approve: ${proposal.title}`} onClick={() => onApprove(proposal.id)}>Approve</button>
        <button className="pc-btn pc-btn--dismiss" aria-label={`Dismiss: ${proposal.title}`} onClick={() => onDismiss(proposal.id)}>Dismiss</button>
      </div>
    </div>
  );
}
