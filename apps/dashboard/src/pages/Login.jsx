import { useState } from 'react';
import './Login.css';

export default function Login({ onSuccess }) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, remember }),
      });

      if (!res.ok) {
        setError('Invalid password');
        setLoading(false);
        return;
      }

      const { token } = await res.json();
      localStorage.setItem('auth_token', token);
      onSuccess();
    } catch {
      setError('Connection error');
      setLoading(false);
    }
  };

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
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
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
