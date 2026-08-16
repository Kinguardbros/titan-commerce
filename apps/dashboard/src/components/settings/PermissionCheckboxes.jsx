import './PermissionCheckboxes.css';

const PERMISSION_LIST = [
  'products:read',
  'products:edit',
  'products:images',
  'products:publications',
  'creatives:generate',
  'admin:users',
  'finance:read',
];

const LABELS = {
  'products:read': 'View products',
  'products:edit': 'Edit products (title, description, price, tags, status)',
  'products:images': 'Manage images (upload, delete, reorder, push creatives)',
  'products:publications': 'Bulk publish/unpublish, CSV export',
  'creatives:generate': 'Generate AI creatives (Studio, Avatars)',
  'admin:users': 'Manage users (admin only, implicit for role=admin)',
  'finance:read': 'View financial data (Profit, Shopify analytics, Cockpit revenue/margin)',
};

export default function PermissionCheckboxes({ value, onChange, disabled }) {
  const toggle = (perm) => {
    if (value.includes(perm)) onChange(value.filter((p) => p !== perm));
    else onChange([...value, perm]);
  };

  return (
    <div className="permission-checkboxes">
      {PERMISSION_LIST.map((perm) => (
        <label key={perm} className="permission-checkbox-row">
          <input
            type="checkbox"
            checked={value.includes(perm)}
            onChange={() => toggle(perm)}
            disabled={disabled}
          />
          <span className="permission-checkbox-key">{perm}</span>
          <span className="permission-checkbox-label">{LABELS[perm]}</span>
        </label>
      ))}
    </div>
  );
}
