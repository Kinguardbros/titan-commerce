import { useState, useEffect, useRef } from 'react';
import { getPipelineLog } from '../lib/api';
import supabase from '../lib/supabase';
import './TerminalLog.css';

const AGENT_COLORS = {
  SCRAPER: '#d4605c',
  FORGE: '#d49a3c',
  PUBLISHER: '#5c8fd4',
  LOOPER: '#8b6fc4',
};

export default function TerminalLog({ storeId }) {
  const [lines, setLines] = useState([]);
  const bodyRef = useRef(null);

  useEffect(() => {
    // Fetch initial logs
    getPipelineLog(storeId)
      .then((data) => {
        if (data) setLines(data.reverse().slice(-20));
      })
      .catch(() => {});

    // Realtime subscription for new logs
    const channel = supabase
      .channel('pipeline-log-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'pipeline_log' },
        (payload) => {
          setLines((prev) => {
            const next = [...prev, payload.new];
            return next.length > 20 ? next.slice(-20) : next;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [storeId]);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [lines]);

  return (
    <div className="term-box">
      <div className="term-head">
        <span className="term-dot r" />
        <span className="term-dot y" />
        <span className="term-dot g" />
        <span className="term-label">Pipeline Log</span>
      </div>
      <div className="term-body" ref={bodyRef}>
        {lines.length === 0 && (
          <div className="tl" style={{ color: 'var(--text4)' }}>No pipeline activity yet</div>
        )}
        {lines.map((l) => (
          <div key={l.id} className="tl">
            <span className="tl-time">
              {(() => {
                const d = new Date(l.created_at);
                const isToday = d.toDateString() === new Date().toDateString();
                return isToday
                  ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                  : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
              })()}
            </span>{' '}
            <span className="tl-agent" style={{ color: AGENT_COLORS[l.agent] || 'var(--text3)' }}>{l.agent}</span>{' '}
            <span className={`tl-msg${l.level === 'error' ? ' tl-msg--error' : l.level === 'warn' ? ' tl-msg--warn' : ''}`}>
              {l.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
