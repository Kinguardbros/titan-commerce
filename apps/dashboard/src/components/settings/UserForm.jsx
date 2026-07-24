import { useState } from 'react';
import PermissionCheckboxes from './PermissionCheckboxes';
import StoreAccessCheckboxes from './StoreAccessCheckboxes';
import './UserForm.css';

export default function UserForm({ user, stores, onSubmit, onCancel, busy }) {
  const isEdit = !!user;
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [role, setRole] = useState(user?.role || 'member');
  const [permissions, setPermissions] = useState(user?.permissions || []);
  const [storeAccess, setStoreAccess] = useState(user?.store_access || []);
  const [active, setActive] = useState(user?.active ?? true);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isEdit) {
      onSubmit({
        user_id: user.id,
        role,
        permissions,
        store_access: storeAccess,
        active,
        full_name: fullName,
        email: email || null,
      });
    } else {
      onSubmit({
        username,
        password,
        full_name: fullName || null,
        email: email || null,
        role,
        permissions,
        store_access: storeAccess,
      });
    }
  };

  return (
    <div
      className="user-form-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? `Edit ${user.username}` : 'Create user'}
    >
      <form className="user-form" onSubmit={handleSubmit}>
        <h2 className="user-form-title">{isEdit ? `Edit ${user.username}` : 'Create user'}</h2>

        {isEdit ? (
          <label>
            Username
            <input value={username} disabled readOnly className="user-form-readonly" />
          </label>
        ) : (
          <>
            <label>
              Username
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={busy}
                autoComplete="off"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={busy}
                autoComplete="new-password"
              />
            </label>
          </>
        )}

        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={busy} />
        </label>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
            placeholder="add later (optional)"
          />
        </label>
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value)} disabled={busy}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>

        {role === 'member' && (
          <>
            <fieldset>
              <legend>Permissions</legend>
              <PermissionCheckboxes value={permissions} onChange={setPermissions} disabled={busy} />
            </fieldset>
            <fieldset>
              <legend>Store access</legend>
              <StoreAccessCheckboxes stores={stores} value={storeAccess} onChange={setStoreAccess} disabled={busy} />
            </fieldset>
          </>
        )}

        {role === 'admin' && (
          <div className="user-form-admin-note">
            Admins implicitly have all permissions and access to all stores.
          </div>
        )}

        {isEdit && (
          <label className="user-form-active">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={busy} />
            Active
          </label>
        )}

        <div className="user-form-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="user-form-submit" disabled={busy}>
            {busy ? 'Working…' : isEdit ? 'Save' : 'Create user'}
          </button>
        </div>
      </form>
    </div>
  );
}
