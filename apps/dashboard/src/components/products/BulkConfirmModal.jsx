import './BulkConfirmModal.css';

export default function BulkConfirmModal({
  open, title, items, confirmLabel, busy, onConfirm, onCancel,
}) {
  if (!open) return null;
  return (
    <div className="bulk-modal__backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="bulk-modal">
        <div className="bulk-modal__title">{title}</div>
        <div className="bulk-modal__body">
          <div className="bulk-modal__count">{items.length} products affected:</div>
          <ul className="bulk-modal__list">
            {items.slice(0, 50).map((it) => (
              <li key={it.id}>{it.title}</li>
            ))}
            {items.length > 50 && <li>… and {items.length - 50} more</li>}
          </ul>
        </div>
        <div className="bulk-modal__actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="bulk-modal__confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
