import { useState, useMemo } from 'react';
import './VariantEditor.css';

export default function VariantEditor({ variants, options, editing, onChange }) {
  const [expanded, setExpanded] = useState({});
  const [allExpanded, setAllExpanded] = useState(false);

  const optionNames = (options || []).map((o) => o.name);
  const groupByOption = optionNames[0] || null;

  // Group variants by option1
  const groups = useMemo(() => {
    if (!groupByOption || !variants?.length) return null;
    const map = new Map();
    for (const v of variants) {
      const key = v.option1 || 'Default';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(v);
    }
    return Array.from(map.entries()).map(([label, items]) => {
      const prices = items.map((v) => v.price);
      const allSame = prices.every((p) => p === prices[0]);
      const thumb = items[0]?.image_id ? variants.find((v) => v.image_id === items[0].image_id) : items[0];
      return { label, items, price: allSame ? prices[0] : null, thumbSrc: null, count: items.length };
    });
  }, [variants, groupByOption]);

  const handleChange = (variantId, field, value) => {
    onChange(variants.map((v) => v.id === variantId ? { ...v, [field]: value, _dirty: true } : v));
  };

  const handleGroupPriceChange = (groupLabel, value) => {
    onChange(variants.map((v) => v.option1 === groupLabel ? { ...v, price: value, _dirty: true } : v));
  };

  const toggleGroup = (label) => {
    setExpanded((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const toggleAll = () => {
    if (!groups) return;
    const next = !allExpanded;
    setAllExpanded(next);
    const map = {};
    for (const g of groups) map[g.label] = next;
    setExpanded(map);
  };

  const isOpen = (label) => allExpanded || expanded[label];

  // Flat table fallback (single option or no options)
  if (!groups || groups.length <= 1) {
    return (
      <div className="ve-wrap">
        <div className="ve-table-wrap">
          <table className="ve-table">
            <thead>
              <tr>
                <th>Variant</th>
                <th>Price</th>
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
                      {editing ? <input className="ve-input" value={v.price || ''} onChange={(e) => handleChange(v.id, 'price', e.target.value)} />
                        : <span className="ve-price">${v.price}</span>}
                    </td>
                    <td>
                      {editing ? <input className="ve-input" value={v.sku || ''} onChange={(e) => handleChange(v.id, 'sku', e.target.value)} />
                        : <span className="ve-sku">{v.sku || '—'}</span>}
                    </td>
                    <td><span className={`ve-inv${(v.inventory_quantity || 0) <= 5 ? ' ve-inv--low' : ''}`}>{v.inventory_quantity ?? '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="ve-wrap">
      {/* Option pills */}
      <div className="ve-option-pills">
        {optionNames.map((name, i) => {
          const vals = [...new Set(variants.map((v) => [v.option1, v.option2, v.option3][i]).filter(Boolean))];
          return (
            <div key={i} className="ve-option-row">
              <span className="ve-option-label">{name}:</span>
              <div className="ve-option-vals">
                {vals.map((val) => <span key={val} className="ve-option-pill">{val}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Grouped table */}
      <div className="ve-table-wrap">
        <table className="ve-table">
          <thead>
            <tr>
              <th className="ve-th-variant">
                <span>Variant</span>
                <button className="ve-expand-all" onClick={toggleAll}>
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </button>
              </th>
              <th>Price</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const open = isOpen(group.label);
              const totalInv = group.items.reduce((s, v) => s + (v.inventory_quantity || 0), 0);
              return (
                <GroupRows
                  key={group.label}
                  group={group}
                  open={open}
                  editing={editing}
                  totalInv={totalInv}
                  onToggle={() => toggleGroup(group.label)}
                  onGroupPriceChange={(val) => handleGroupPriceChange(group.label, val)}
                  onVariantChange={handleChange}
                  secondOption={optionNames[1]}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group, open, editing, totalInv, onToggle, onGroupPriceChange, onVariantChange, secondOption }) {
  return (
    <>
      {/* Group header row */}
      <tr className="ve-group-row" onClick={onToggle}>
        <td className="ve-group-cell">
          <span className={`ve-arrow${open ? ' ve-arrow--open' : ''}`}>&#9656;</span>
          <span className="ve-group-label">{group.label}</span>
          <span className="ve-group-count">{group.count} variant{group.count !== 1 ? 's' : ''}</span>
        </td>
        <td>
          {editing && group.price !== null ? (
            <input className="ve-input" value={group.price || ''} onClick={(e) => e.stopPropagation()}
              onChange={(e) => onGroupPriceChange(e.target.value)} />
          ) : (
            <span className="ve-price">{group.price ? `$ ${group.price}` : 'varies'}</span>
          )}
        </td>
        <td>
          <span className={`ve-inv${totalInv <= 5 ? ' ve-inv--low' : ''}`}>
            {totalInv || '—'}
          </span>
        </td>
      </tr>

      {/* Expanded child rows */}
      {open && group.items.map((v) => {
        const sizeLabel = v.option2 || v.option3 || v.title;
        return (
          <tr key={v.id} className="ve-child-row">
            <td className="ve-child-cell">
              <span className="ve-child-size">{sizeLabel}</span>
              <span className="ve-child-sku">{v.sku || ''}</span>
            </td>
            <td>
              {editing ? (
                <input className="ve-input" value={v.price || ''} onChange={(e) => onVariantChange(v.id, 'price', e.target.value)} />
              ) : (
                <span className="ve-price">$ {v.price}</span>
              )}
            </td>
            <td>
              <span className={`ve-inv${(v.inventory_quantity || 0) <= 5 ? ' ve-inv--low' : ''}`}>
                {v.inventory_quantity ?? '—'}
              </span>
            </td>
          </tr>
        );
      })}
    </>
  );
}
