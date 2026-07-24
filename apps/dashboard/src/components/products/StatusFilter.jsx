import './StatusFilter.css';

const OPTIONS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
];

export default function StatusFilter({ value, onChange }) {
  return (
    <div className="pf-group">
      <div className="pf-label">Status</div>
      <div className="pf-chips">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            className={`pf-chip${value === o.key ? ' pf-chip--active' : ''}`}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
