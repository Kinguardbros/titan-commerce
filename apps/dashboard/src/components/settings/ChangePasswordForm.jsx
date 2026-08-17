import { useState } from 'react';
import { changeOwnPassword } from '../../lib/api';
import './ChangePasswordForm.css';

const MIN_PASSWORD_LENGTH = 8;

// Self-service password change (P1-14, AUDIT-2026-08). Shared between two
// contexts:
//  - Settings tab (always visible, any logged-in user, non-admin included) —
//    `toast` is passed in from useToast() for success/error feedback.
//  - Forced first-login gate in Login.jsx (`forced` + `initialCurrentPassword`)
//    — rendered OUTSIDE ToastProvider, so `toast` is omitted and feedback
//    falls back to an inline banner.
// Either way, a successful change bumps token_version server-side, which
// invalidates the token used to make the request — so success always ends in
// clearing auth_token + a full reload back to the login screen.
export default function ChangePasswordForm({ forced = false, initialCurrentPassword = '', toast = null }) {
  const [currentPassword, setCurrentPassword] = useState(initialCurrentPassword);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inlineError, setInlineError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const notifyError = (message) => {
    if (toast) toast.error(message);
    else setInlineError(message);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setInlineError('');

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      notifyError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPassword !== confirmPassword) {
      notifyError('New password and confirmation do not match');
      return;
    }

    setBusy(true);
    try {
      await changeOwnPassword(currentPassword, newPassword);
      if (toast) toast.success('Password changed. Redirecting to login…');
      setDone(true);
      setTimeout(() => {
        localStorage.removeItem('auth_token');
        window.location.reload();
      }, 1200);
    } catch (err) {
      notifyError(err.message);
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="change-password-form change-password-form--done">
        <p>Password changed. Redirecting to login…</p>
      </div>
    );
  }

  return (
    <form className="change-password-form" onSubmit={handleSubmit}>
      <h2>{forced ? 'You must set a new password' : 'Change my password'}</h2>
      {forced && (
        <p className="change-password-form-hint">
          Your password was reset by an admin. Choose a new password to continue.
        </p>
      )}

      <label>
        Current password
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </label>

      <label>
        New password
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>

      <label>
        Confirm new password
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>

      {inlineError && <div className="change-password-form-error">{inlineError}</div>}

      <button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>
        {busy ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
