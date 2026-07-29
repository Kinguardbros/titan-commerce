import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import './ApiTokenDisplayModal.css';

// One-time reveal modal for a freshly generated api_token — mirrors TempPasswordModal
// in UsersManager.jsx. result = { username, api_token }.
export default function ApiTokenDisplayModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.api_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('[ApiTokenDisplayModal] Clipboard write failed:', err);
    }
  };

  return (
    <div className="api-token-backdrop" role="dialog" aria-modal="true" aria-label="API token">
      <div className="api-token-modal">
        <h2 className="api-token-title">API token for &quot;{result.username}&quot;</h2>
        <p className="api-token-warning">Copy it now — it won&apos;t be shown again. Paste it into the Tampermonkey userscript config.</p>
        <div className="api-token-value-row">
          <code className="api-token-value">{result.api_token}</code>
          <button type="button" className="api-token-copy" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="api-token-hint">Generating a new token immediately invalidates the previous one.</p>
        <div className="api-token-actions">
          <button type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
