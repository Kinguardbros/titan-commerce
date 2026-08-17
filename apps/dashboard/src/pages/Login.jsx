import { useState } from 'react';
import ChangePasswordForm from '../components/settings/ChangePasswordForm';
import './Login.css';

export default function Login({ onSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Set once a login response carries must_change_password:true (admin-issued
  // temp password, P1-14 AUDIT-2026-08) — blocks reaching the dashboard until
  // the user picks a new password. The just-logged-in token is already in
  // localStorage at that point, so ChangePasswordForm can call
  // change_own_password directly; success clears it and reloads back here.
  const [forcePasswordChange, setForcePasswordChange] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim() || undefined, password, remember }),
      });

      if (!res.ok) {
        setError('Invalid username or password');
        setLoading(false);
        return;
      }

      const { token, must_change_password } = await res.json();
      localStorage.setItem('auth_token', token);
      if (must_change_password) {
        setForcePasswordChange(true);
        setLoading(false);
        return;
      }
      onSuccess();
    } catch (err) {
      console.error('[Login] Connection error:', err?.message || err);
      setError('Connection error');
      setLoading(false);
    }
  };

  if (forcePasswordChange) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">
            <div className="login-logo-mark">T</div>
            <div className="login-logo-brand">Titan Commerce</div>
            <div className="login-logo-sub">Command Center</div>
          </div>
          <ChangePasswordForm forced initialCurrentPassword={password} />
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">
          <div className="login-logo-mark">T</div>
          <div className="login-logo-brand">Titan Commerce</div>
          <div className="login-logo-sub">Command Center</div>
        </div>

        <input
          className="login-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username (leave blank for master login)"
          autoFocus
        />

        <input
          className="login-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
        />

        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember me
        </label>

        {error && <div className="login-error">{error}</div>}

        <button className="login-btn" type="submit" disabled={loading || !password}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>

        <div className="login-hint">Wrong password? Contact admin.</div>
      </form>
    </div>
  );
}
