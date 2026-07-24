import { useState, useEffect, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { listUsers, createUser, updateUser, deleteUser, resetPassword } from '../../lib/api';
import { useActiveStore } from '../../hooks/useActiveStore.jsx';
import { useToast } from '../../hooks/useToast.jsx';
import UserForm from './UserForm';
import './UsersManager.css';

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return 'Never';
  const diffMs = Date.now() - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function TempPasswordModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temp_password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[UsersManager] Clipboard write failed:', err);
    }
  };

  return (
    <div className="temp-pw-backdrop" role="dialog" aria-modal="true" aria-label="Temporary password">
      <div className="temp-pw-modal">
        <h2 className="temp-pw-title">Password reset for &quot;{result.username}&quot;</h2>
        <p className="temp-pw-warning">Copy it now — it won&apos;t be shown again.</p>
        <div className="temp-pw-value-row">
          <code className="temp-pw-value">{result.temp_password}</code>
          <button type="button" className="temp-pw-copy" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div className="temp-pw-actions">
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ user, busy, onConfirm, onCancel }) {
  return (
    <div className="user-delete-backdrop" role="dialog" aria-modal="true" aria-label="Delete user">
      <div className="user-delete-modal">
        <h2 className="user-delete-title">Delete user</h2>
        <p>
          Delete <strong>{user.username}</strong>? This cannot be undone.
        </p>
        <div className="user-delete-actions">
          <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="user-delete-confirm" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersManager() {
  const { stores } = useActiveStore();
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [deletingUser, setDeletingUser] = useState(null);
  const [tempPasswordResult, setTempPasswordResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { users: u } = await listUsers();
      setUsers(u || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async (payload) => {
    setBusy(true);
    try {
      await createUser(payload);
      toast.success(`User "${payload.username}" created`);
      setFormOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (payload) => {
    setBusy(true);
    try {
      await updateUser(payload);
      toast.success('User updated');
      setFormOpen(false);
      setEditingUser(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deletingUser) return;
    setBusy(true);
    try {
      await deleteUser(deletingUser.id);
      toast.success(`User "${deletingUser.username}" deleted`);
      setDeletingUser(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleResetPassword = async (user) => {
    try {
      const { temp_password } = await resetPassword(user.id);
      setTempPasswordResult({ username: user.username, temp_password });
    } catch (err) {
      toast.error(err.message);
    }
  };

  const storeNames = (ids) => (ids || []).map((id) => stores.find((s) => s.id === id)?.name || id).join(', ') || '—';

  if (loading) return <div className="users-manager-loading">Loading users…</div>;

  return (
    <div className="users-manager">
      <div className="users-manager-header">
        <h2>Users</h2>
        <button
          type="button"
          className="users-manager-create-btn"
          onClick={() => { setEditingUser(null); setFormOpen(true); }}
        >
          Create user
        </button>
      </div>

      <div className="users-table-wrap">
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Full name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Permissions</th>
              <th>Store access</th>
              <th>Active</th>
              <th>Last login</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={9} className="users-table-empty">No users yet.</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.username}</td>
                <td>{u.full_name || '—'}</td>
                <td>{u.email || '—'}</td>
                <td>
                  <span className={`users-role-badge users-role-badge--${u.role}`}>{u.role}</span>
                </td>
                <td>{u.role === 'admin' ? 'all' : (u.permissions || []).length ? `${u.permissions.length} granted` : '—'}</td>
                <td>{u.role === 'admin' ? 'all' : storeNames(u.store_access)}</td>
                <td>
                  <span className={`users-active-dot ${u.active ? 'is-active' : 'is-inactive'}`} />
                  {u.active ? 'Yes' : 'No'}
                </td>
                <td>{timeAgo(u.last_login)}</td>
                <td className="users-table-actions">
                  <button type="button" onClick={() => { setEditingUser(u); setFormOpen(true); }}>Edit</button>
                  <button type="button" onClick={() => handleResetPassword(u)}>Reset password</button>
                  <button type="button" className="users-table-delete" onClick={() => setDeletingUser(u)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formOpen && (
        <UserForm
          user={editingUser}
          stores={stores}
          busy={busy}
          onSubmit={editingUser ? handleUpdate : handleCreate}
          onCancel={() => { setFormOpen(false); setEditingUser(null); }}
        />
      )}

      {deletingUser && (
        <DeleteConfirmModal
          user={deletingUser}
          busy={busy}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeletingUser(null)}
        />
      )}

      {tempPasswordResult && (
        <TempPasswordModal result={tempPasswordResult} onClose={() => setTempPasswordResult(null)} />
      )}
    </div>
  );
}
