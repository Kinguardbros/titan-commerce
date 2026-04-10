import './VariantEditor.css';

export default function VariantEditor({ variants, options, editing, onChange }) {
  const optionNames = (options || []).map((o) => o.name);

  const handleChange = (variantId, field, value) => {
    onChange(variants.map((v) => v.id === variantId ? { ...v, [field]: value, _dirty: true } : v));
  };

  return (
    <div className="ve-wrap">
      {optionNames.length > 0 && (
        <div className="ve-options">
          {optionNames.map((name, i) => (
            <span key={i} className="ve-option-badge">Option {i + 1}: {name}</span>
          ))}
        </div>
      )}
      <div className="ve-table-wrap">
        <table className="ve-table">
          <thead>
            <tr>
              <th>Variant</th>
              <th>Price</th>
              <th>Compare at</th>
              <th>SKU</th>
              <th>Inventory</th>
            </tr>
          </thead>
          <tbody>
            {(variants || []).map((v) => {
              const label = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ');
              return (
                <tr key={v.id}>
                  <td className="ve-variant-name">{label || v.title}</td>
                  <td>
                    {editing ? (
                      <input className="ve-input" value={v.price || ''} onChange={(e) => handleChange(v.id, 'price', e.target.value)} />
                    ) : (
                      <span className="ve-price">${v.price}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input className="ve-input" value={v.compare_at_price || ''} onChange={(e) => handleChange(v.id, 'compare_at_price', e.target.value)} placeholder="—" />
                    ) : (
                      <span>{v.compare_at_price ? `$${v.compare_at_price}` : '—'}</span>
                    )}
                  </td>
                  <td>
                    {editing ? (
                      <input className="ve-input" value={v.sku || ''} onChange={(e) => handleChange(v.id, 'sku', e.target.value)} />
                    ) : (
                      <span className="ve-sku">{v.sku || '—'}</span>
                    )}
                  </td>
                  <td>
                    <span className={`ve-inv ${(v.inventory_quantity || 0) <= 5 ? 've-inv--low' : ''}`}>
                      {v.inventory_quantity ?? '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
