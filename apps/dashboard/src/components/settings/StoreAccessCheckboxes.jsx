import './StoreAccessCheckboxes.css';

export default function StoreAccessCheckboxes({ stores, value, onChange, disabled }) {
  const toggle = (storeId) => {
    if (value.includes(storeId)) onChange(value.filter((id) => id !== storeId));
    else onChange([...value, storeId]);
  };

  return (
    <div className="store-access-checkboxes">
      {(stores || []).map((s) => (
        <label key={s.id} className="store-access-checkbox-row">
          <input
            type="checkbox"
            checked={value.includes(s.id)}
            onChange={() => toggle(s.id)}
            disabled={disabled}
          />
          {s.name}
        </label>
      ))}
      {(!stores || stores.length === 0) && (
        <div className="store-access-empty">No stores available</div>
      )}
    </div>
  );
}
