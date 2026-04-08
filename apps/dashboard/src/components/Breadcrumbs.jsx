import './Breadcrumbs.css';

export default function Breadcrumbs({ items }) {
  if (!items || items.length <= 1) return null;

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol className="breadcrumbs-list">
        {items.map((item, i) => (
          <li key={i} className="breadcrumbs-item">
            {i > 0 && <span className="breadcrumbs-sep" aria-hidden="true">/</span>}
            {item.onClick ? (
              <button className="breadcrumbs-link" onClick={item.onClick}>{item.label}</button>
            ) : (
              <span className="breadcrumbs-current" aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
