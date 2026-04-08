import { useState, useEffect, useCallback } from 'react';
import { getPendingCreatives, approveAd, rejectAd, updateCreative } from '../lib/api';
import supabase from '../lib/supabase';
import { useToast } from '../hooks/useToast.jsx';
import CreativeEditor from './CreativeEditor';
import './ApprovalQueue.css';

export default function ApprovalQueue({ storeId }) {
  const toast = useToast();
  const [creatives, setCreatives] = useState([]);
  const [approved, setApproved] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingCreative, setEditingCreative] = useState(null);

  const fetchCreatives = useCallback(async () => {
    try {
      const data = await getPendingCreatives(storeId);
      if (data) setCreatives(data);
    } catch (err) {
      console.error('Failed to fetch creatives:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    fetchCreatives();

    const channel = supabase
      .channel('creatives-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'creatives', filter: 'status=eq.pending' },
        (payload) => { setCreatives((prev) => [payload.new, ...prev]); }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'creatives' },
        (payload) => {
          if (payload.new.status !== 'pending') {
            setCreatives((prev) => prev.filter((c) => c.id !== payload.new.id));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchCreatives]);

  const handleApprove = async (id) => {
    const creative = creatives.find((c) => c.id === id);
    try {
      await approveAd(id, 'Team');
      if (creative) setApproved((prev) => [creative, ...prev]);
      toast.success('Creative approved!');
    } catch (err) {
      console.error('Approve failed:', err);
      toast.error(`Approve failed: ${err.message}`);
    }
    setCreatives((prev) => prev.filter((c) => c.id !== id));
    setEditingCreative(null);
  };

  const handleReject = async (id) => {
    const creative = creatives.find((c) => c.id === id);
    try {
      await rejectAd(id, 'Team');
      if (creative) setRejected((prev) => [creative, ...prev]);
      toast.success('Creative rejected');
    } catch (err) {
      console.error('Reject failed:', err);
      toast.error(`Reject failed: ${err.message}`);
    }
    setCreatives((prev) => prev.filter((c) => c.id !== id));
    setEditingCreative(null);
  };

  const handleSave = async (id, updates) => {
    try {
      await updateCreative(id, updates);
      const updated = creatives.map((c) => (c.id === id ? { ...c, ...updates } : c));
      setCreatives(updated);
      setEditingCreative(updated.find((c) => c.id === id) || null);
    } catch (err) {
      console.error('Save failed:', err);
      toast.error(`Save failed: ${err.message}`);
    }
  };

  if (loading) {
    return (
      <div className="aq-empty">
        <div className="aq-empty-text">Loading creatives...</div>
      </div>
    );
  }

  return (
    <>
      {/* Pending queue */}
      {creatives.length > 0 && (
        <div className="aq">
          <div className="aq-header">
            <div className="aq-title">Approval Queue</div>
            <div className="aq-count">{creatives.length} pending</div>
          </div>
          <div className="aq-grid">
            {creatives.map((c) => (
              <CreativeCard key={c.id} creative={c} onClick={() => setEditingCreative(c)} />
            ))}
          </div>
        </div>
      )}

      {creatives.length === 0 && approved.length === 0 && rejected.length === 0 && (
        <div className="aq-empty">
          <span className="aq-empty-icon">✓</span>
          <div className="aq-empty-text">No pending creatives</div>
        </div>
      )}

      {/* Approved */}
      {approved.length > 0 && (
        <div className="aq" style={{ marginTop: 24 }}>
          <div className="aq-header">
            <div className="aq-title" style={{ color: 'var(--emerald)' }}>Approved</div>
            <div className="aq-count" style={{ color: 'var(--emerald)', background: 'var(--emerald-glow)' }}>{approved.length}</div>
          </div>
          <div className="aq-grid">
            {approved.map((c) => (
              <CreativeCard key={c.id} creative={c} status="approved" />
            ))}
          </div>
        </div>
      )}

      {/* Rejected */}
      {rejected.length > 0 && (
        <div className="aq" style={{ marginTop: 24 }}>
          <div className="aq-header">
            <div className="aq-title" style={{ color: 'var(--coral)' }}>Rejected</div>
            <div className="aq-count" style={{ color: 'var(--coral)', background: 'var(--coral-glow)' }}>{rejected.length}</div>
          </div>
          <div className="aq-grid">
            {rejected.map((c) => (
              <CreativeCard key={c.id} creative={c} status="rejected" />
            ))}
          </div>
        </div>
      )}

      {/* Editor modal */}
      <CreativeEditor
        creative={editingCreative}
        open={!!editingCreative}
        onClose={() => setEditingCreative(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        onSave={handleSave}
        onRegenerate={(id, updated) => {
          setCreatives((prev) => prev.map((c) => (c.id === id ? { ...c, ...updated } : c)));
          setEditingCreative((prev) => prev && prev.id === id ? { ...prev, ...updated } : prev);
        }}
      />
    </>
  );
}

function CreativeCard({ creative: c, onClick, status }) {
  const productName = c.brief?.product_name || c.headline || 'New Creative';
  const hasImage = c.file_url && !c.file_url.includes('undefined');
  const agent = { color: '#d49a3c', icon: '🔥', name: 'FORGE' };

  return (
    <div className={`aq-card${status ? ' aq-card--' + status : ''}`} onClick={onClick} style={onClick ? { cursor: 'pointer' } : {}}>
      <div className="aq-preview" style={
        hasImage
          ? { backgroundImage: `url(${c.file_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
          : { background: 'var(--surface)' }
      }>
        {status && (
          <span className={`pill ${status === 'approved' ? 'active' : 'ended'}`} style={{ position: 'absolute', top: 8, left: 8 }}>
            {status}
          </span>
        )}
        <span className={`pill ${c.format === 'video' ? 'learning' : 'pending'}`}>{c.format}</span>
      </div>
      <div className="aq-body">
        <div className="aq-name">{productName}</div>
        <div className="aq-hook">"{c.hook_used || ''}"</div>
        <div className="aq-headline">{c.headline || ''}</div>
        <div className="aq-meta">
          <span style={{ color: agent.color }}>{agent.icon} FORGE</span>
          <span>Variant {c.variant_index || '?'}</span>
        </div>
      </div>
    </div>
  );
}
