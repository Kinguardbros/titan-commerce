import { useState } from 'react';
import './MetafieldEditor.css';

export default function MetafieldEditor({ metafields, editing, onChange }) {
  const [newNs, setNewNs] = useState('custom');
  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  const handleChange = (idx, field, value) => {
    onChange(metafields.map((m, i) => i === idx ? { ...m, [field]: value, _dirty: true } : m));
  };

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange([...metafields, { namespace: newNs, key: newKey, value: newVal, type: 'single_line_text_field', _dirty: true, _new: true }]);
    setNewKey('');
    setNewVal('');
  };

  // Filter out size_chart_text (handled by SizeChartEditor)
  const visible = metafields.filter((m) => !(m.namespace === 'custom' && m.key === 'size_chart_text'));

  if (!editing && visible.length === 0) {
    return <div className="mfe-empty">No metafields</div>;
  }

  return (
    <div className="mfe-wrap">
      {visible.map((m, i) => (
        <div key={m.id || `${m.namespace}.${m.key}`} className="mfe-row">
          <span className="mfe-key">{m.namespace}.{m.key}</span>
          {editing ? (
            <textarea className="mfe-value-edit" value={m.value || ''} onChange={(e) => handleChange(i, 'value', e.target.value)} rows={1} />
          ) : (
            <span className="mfe-value">{(m.value || '').slice(0, 120)}{m.value?.length > 120 ? '...' : ''}</span>
          )}
        </div>
      ))}
      {editing && (
        <div className="mfe-add">
          <input className="mfe-add-input mfe-add-ns" value={newNs} onChange={(e) => setNewNs(e.target.value)} placeholder="namespace" />
          <input className="mfe-add-input" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="key" />
          <input className="mfe-add-input mfe-add-val" value={newVal} onChange={(e) => setNewVal(e.target.value)} placeholder="value" />
          <button className="mfe-add-btn" onClick={handleAdd} disabled={!newKey.trim()}>+</button>
        </div>
      )}
    </div>
  );
}
