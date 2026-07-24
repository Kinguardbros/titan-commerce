import { lazy, Suspense } from 'react';

const UsersManager = lazy(() => import('../components/settings/UsersManager'));

export default function Settings() {
  return (
    <div className="settings-page">
      <h1>Settings</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <UsersManager />
      </Suspense>
    </div>
  );
}
