import { lazy, Suspense } from 'react';
import { useUser } from '../hooks/useUser.jsx';
import { useToast } from '../hooks/useToast.jsx';
import ChangePasswordForm from '../components/settings/ChangePasswordForm';
import './Settings.css';

const UsersManager = lazy(() => import('../components/settings/UsersManager'));

// Settings shell — visible to EVERY logged-in user (App.jsx no longer gates
// this tab on role==='admin'; self-service password change is P1-14,
// AUDIT-2026-08). Users management (the admin table) stays admin-only, gated
// here rather than at the tab level. Master fallback has no backing users
// row, so it skips the change-password section entirely (backend also
// guards this — see change_own_password in lib/actions/users.js).
export default function Settings() {
  const { user } = useUser();
  const toast = useToast();

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      {!user?.master && <ChangePasswordForm toast={toast} />}
      {user?.role === 'admin' && (
        <Suspense fallback={<div className="settings-page-loading">Loading…</div>}>
          <UsersManager />
        </Suspense>
      )}
    </div>
  );
}
