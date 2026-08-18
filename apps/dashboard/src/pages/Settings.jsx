import { lazy, Suspense, useState } from 'react';
import { useUser } from '../hooks/useUser.jsx';
import { useToast } from '../hooks/useToast.jsx';
import { cleanupOrphanReviewPhotos } from '../lib/api';
import ChangePasswordForm from '../components/settings/ChangePasswordForm';
import './Settings.css';

const UsersManager = lazy(() => import('../components/settings/UsersManager'));

// Admin-only maintenance action: sweep review photos left orphaned in Storage by
// pending/rejected reviews older than 30 days. Companion to the set_review_status
// hook (lib/actions/reviews.js) which only cleans up NEW rejects going forward —
// this sweep is the on-demand catch-up for everything before that + reviews that
// just sit pending forever. Cross-store (no store picker) — backend is gated on
// admin:users, same permission that already gates every other cross-store admin
// operation (users_list/create_user/etc in lib/actions/users.js).
function MaintenanceSection({ toast }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runCleanup = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await cleanupOrphanReviewPhotos();
      setResult(`Cleaned ${res.reviews_cleaned} review(s) — removed ${res.files_removed} file(s)${res.files_failed ? `, ${res.files_failed} failed` : ''}`);
      toast.success(`Orphan photo sweep: ${res.reviews_cleaned} review(s) cleaned, ${res.files_removed} file(s) removed`);
    } catch (err) {
      setResult('Sweep failed: ' + err.message);
      toast.error(`Orphan photo sweep failed: ${err.message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="settings-maintenance">
      <h2>Maintenance</h2>
      <div className="settings-maintenance-row">
        <button className="settings-maintenance-btn" onClick={runCleanup} disabled={running}>
          {running ? 'Cleaning…' : 'Cleanup orphan photos'}
        </button>
        <span className="settings-maintenance-hint">Removes review photos for pending/rejected reviews older than 30 days, across all stores</span>
      </div>
      {result && <div className="settings-maintenance-result">{result}</div>}
    </div>
  );
}

// Settings shell — visible to EVERY logged-in user (App.jsx no longer gates
// this tab on role==='admin'; self-service password change is P1-14,
// AUDIT-2026-08). Users management (the admin table) and Maintenance stay
// admin-only, gated here rather than at the tab level. Master fallback has no
// backing users row, so it skips the change-password section entirely (backend
// also guards this — see change_own_password in lib/actions/users.js).
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
      {user?.role === 'admin' && <MaintenanceSection toast={toast} />}
    </div>
  );
}
