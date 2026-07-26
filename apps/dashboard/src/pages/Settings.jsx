import { lazy, Suspense } from 'react';
import './Settings.css';

const UsersManager = lazy(() => import('../components/settings/UsersManager'));

// Settings shell — admin-only (gated in App.jsx). Renders Users management for
// now; future admin sections (e.g. store config) can be added as sibling
// sections here without touching UsersManager.
export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <Suspense fallback={<div className="settings-page-loading">Loading…</div>}>
        <UsersManager />
      </Suspense>
    </div>
  );
}
