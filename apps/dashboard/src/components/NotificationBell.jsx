import { useState, useEffect, useCallback, useRef } from 'react';
import { getPipelineLog } from '../lib/api';
import supabase from '../lib/supabase';
import './NotificationBell.css';

const LEVEL_ICONS = { success: '✓', info: '●', error: '✕', warn: '⚠' };
const LEVEL_COLORS = { success: 'var(--accent-success, #22c55e)', info: 'var(--text3, #888)', error: 'var(--coral, #ef4444)', warn: 'var(--gold, #d4a853)' };
const AGENT_LABELS = {
  IMPORTER: 'Import', FORGE: 'Creative', PUBLISHER: 'Publish', SCRAPER: 'Sync',
  OPTIMIZER: 'Optimize', AVATAR: 'Avatar', CLEANUP: 'Cleanup', AGENT: 'System',
  EDITOR: 'Editor', PRICING: 'Pricing', SKILL_GEN: 'Skills',
};
const FILTERS = ['all', 'success', 'info', 'error'];

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function NotificationBell({ storeId, onNavigateToProduct }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [lastSeen, setLastSeen] = useState(() => {
    try { return localStorage.getItem(`notif_seen_${storeId}`) || ''; } catch { return ''; }
  });
  const ref = useRef(null);

  const fetchLogs = useCallback(async () => {
    if (!storeId) return;
    try {
      const data = await getPipelineLog(storeId);
      setLogs(Array.isArray(data) ? data.slice(0, 50) : []);
    } catch { /* silent */ }
  }, [storeId]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Realtime
  useEffect(() => {
    if (!storeId) return;
    const ch = supabase.channel(`notif-${storeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pipeline_log' },
        (payload) => { if (payload.new?.store_id === storeId || !payload.new?.store_id) setLogs((prev) => [payload.new, ...prev].slice(0, 50)); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleOpen = () => {
    setOpen((p) => !p);
    if (!open) {
      const newest = logs[0]?.created_at || new Date().toISOString();
      setLastSeen(newest);
      try { localStorage.setItem(`notif_seen_${storeId}`, newest); } catch { /* */ }
    }
  };

  const unreadCount = lastSeen ? logs.filter((l) => l.created_at > lastSeen).length : logs.length;
  const filtered = filter === 'all' ? logs : logs.filter((l) => (l.level || 'info') === filter);

  return (
    <div className="nb-wrap" ref={ref}>
      <button className="nb-bell" onClick={handleOpen} aria-label="Notifications">
        <span className="nb-bell-icon">🔔</span>
        {unreadCount > 0 && <span className="nb-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="nb-dropdown">
          <div className="nb-header">
            <span className="nb-title">Notifications</span>
            <div className="nb-filters">
              {FILTERS.map((f) => (
                <button key={f} className={`nb-filter${filter === f ? ' nb-filter--active' : ''}`} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="nb-list">
            {filtered.length === 0 ? (
              <div className="nb-empty">No notifications</div>
            ) : (
              filtered.map((log) => {
                const level = log.level || 'info';
                const isUnread = lastSeen ? log.created_at > lastSeen : true;
                const meta = log.metadata ? (typeof log.metadata === 'string' ? (() => { try { return JSON.parse(log.metadata); } catch { return {}; } })() : log.metadata) : {};
                const clickable = !!(meta.product_id && onNavigateToProduct);
                return (
                  <div key={log.id}
                    className={`nb-item${isUnread ? ' nb-item--unread' : ''}${clickable ? ' nb-item--clickable' : ''}`}
                    onClick={clickable ? () => { onNavigateToProduct(meta.product_id); setOpen(false); } : undefined}>
                    <span className="nb-item-icon" style={{ color: LEVEL_COLORS[level] }}>{LEVEL_ICONS[level] || '●'}</span>
                    <div className="nb-item-body">
                      <div className="nb-item-agent">{AGENT_LABELS[log.agent] || log.agent}</div>
                      <div className="nb-item-msg">{log.message}</div>
                    </div>
                    <span className="nb-item-time">{timeAgo(log.created_at)}</span>
                    {clickable && <span className="nb-item-arrow">→</span>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
