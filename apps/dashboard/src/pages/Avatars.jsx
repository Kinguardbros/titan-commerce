import { useState, useEffect, useRef, useCallback } from 'react';
import { getAvatars, getSkills, generateAvatar, uploadStoreDoc, generateSkills } from '../lib/api';
import AvatarDetail from '../components/AvatarDetail';
import AvatarBuilder from '../components/AvatarBuilder';
import { useToast } from '../hooks/useToast.jsx';
import './Avatars.css';

export default function Avatars({ storeId, store }) {
  const toast = useToast();
  const [avatars, setAvatars] = useState([]);
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPersona, setSelectedPersona] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // Fetch existing avatars + personas from audience-personas skill
  useEffect(() => {
    if (!storeId) return;
    Promise.all([
      getAvatars(storeId),
      getSkills(storeId),
    ]).then(([avatarData, skillsData]) => {
      setAvatars(avatarData || []);
      // Parse personas from audience-personas skill content
      const audienceSkill = (skillsData.skills || []).find(s => s.skill_type === 'audience-personas');
      if (audienceSkill?.content) {
        const parsed = [];
        const regex = /(?:###?\s*|(?:\*\*))?\s*(\w+)\s*\((\d+)\)\s*(?:\*\*)?\s*[—–-]\s*(.+?)(?:\n|$)/g;
        let m;
        while ((m = regex.exec(audienceSkill.content)) !== null) {
          parsed.push({ name: m[1], age: m[2], label: m[3].trim().replace(/\*+$/, '') });
        }
        // Fallback regex
        if (!parsed.length) {
          const rx2 = /###\s*Persona\s*\d+:\s*(\w+)\s*"([^"]+)"\s*\n[^]*?(?:\*\*Age\*\*|Age):\s*(\d+)/g;
          while ((m = rx2.exec(audienceSkill.content)) !== null) {
            parsed.push({ name: m[1], age: m[3], label: m[2].trim() });
          }
        }
        setPersonas(parsed);
      }
    }).catch(err => {
      console.error('[Avatars] Load failed:', { error: err.message });
    }).finally(() => setLoading(false));
  }, [storeId]);

  // Merge personas with existing avatars
  const mergedPersonas = personas.map(p => {
    const avatar = avatars.find(a => a.persona_name === p.name);
    return { ...p, reference_url: avatar?.reference_url || null, variants: avatar?.variants || [], description: avatar?.description || '' };
  });

  const refresh = useCallback(() => {
    Promise.all([
      getAvatars(storeId),
      getSkills(storeId),
    ]).then(([avatarData, skillsData]) => {
      setAvatars(avatarData || []);
      const audienceSkill = (skillsData.skills || []).find(s => s.skill_type === 'audience-personas');
      if (audienceSkill?.content) {
        const parsed = [];
        const rx1 = /(?:###?\s*|(?:\*\*))?\s*(\w+)\s*\((\d+)\)\s*(?:\*\*)?\s*[—–-]\s*(.+?)(?:\n|$)/g;
        let m; while ((m = rx1.exec(audienceSkill.content)) !== null) parsed.push({ name: m[1], age: m[2], label: m[3].trim().replace(/\*+$/, '') });
        if (!parsed.length) {
          const rx2 = /###\s*Persona\s*\d+:\s*(\w+)\s*"([^"]+)"\s*\n[^]*?(?:\*\*Age\*\*|Age):\s*(\d+)/g;
          while ((m = rx2.exec(audienceSkill.content)) !== null) parsed.push({ name: m[1], age: m[3], label: m[2].trim() });
        }
        if (parsed.length) setPersonas(parsed);
      }
    }).catch(() => {});
  }, [storeId]);

  const handleDocUpload = async (file) => {
    const allowed = ['.pdf', '.docx', '.doc', '.md', '.txt'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    if (!allowed.includes(ext)) { toast.error('Supported: PDF, DOCX, MD, TXT'); return; }
    setUploading(true);
    try {
      const reader = new FileReader();
      const base64 = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result.includes(',') ? reader.result.split(',')[1] : reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const storeName = store?.name || 'Store';
      await uploadStoreDoc(storeName, file.name, base64, storeId, true);
      toast.info('Processing document...');
      await generateSkills(storeId);
      toast.success('Document imported — personas updated');
      refresh();
    } catch (err) {
      console.error('[Avatars] Doc upload failed:', { error: err.message });
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="av-loading">Loading avatars...</div>;

  return (
    <div className="av-page">
      <div className="av-header">
        <div>
          <div className="av-title">Avatar Studio</div>
          <div className="av-subtitle">Manage model references for consistent product photos</div>
        </div>
        <div className="av-header-actions">
          <button className="av-import-btn" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Importing...' : '📄 Import Doc'}
          </button>
          <button className="av-create-btn" onClick={() => setShowBuilder(true)}>+ Create New</button>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.doc,.md,.txt" hidden onChange={(e) => { if (e.target.files?.[0]) handleDocUpload(e.target.files[0]); e.target.value = ''; }} />
      </div>

      <div className="av-grid">
        {mergedPersonas.map(p => (
          <div key={p.name} className="av-card" onClick={() => setSelectedPersona(p)}>
            <div className="av-card-img">
              {p.reference_url ? (
                <img src={p.reference_url} alt={p.name} />
              ) : (
                <div className="av-card-placeholder">?</div>
              )}
              {!p.reference_url && (
                <button
                  className="av-card-gen"
                  title="Generate avatar from persona"
                  onClick={(e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    btn.disabled = true;
                    btn.textContent = '...';
                    generateAvatar(storeId, p.name, p.description || p.label)
                      .then(() => { toast.success(`Generating avatar for ${p.name}`); refresh(); })
                      .catch(err => toast.error(`Failed: ${err.message}`))
                      .finally(() => { btn.disabled = false; btn.textContent = '🎲'; });
                  }}
                >🎲</button>
              )}
            </div>
            <div className="av-card-info">
              <div className="av-card-name">{p.name}, {p.age}</div>
              <div className="av-card-label">{p.label}</div>
            </div>
          </div>
        ))}
      </div>

      {selectedPersona && (
        <AvatarDetail
          persona={selectedPersona}
          storeId={storeId}
          storeName={store?.name}
          onClose={() => setSelectedPersona(null)}
          onUpdated={() => { refresh(); }}
        />
      )}
      {showBuilder && (
        <AvatarBuilder storeId={storeId} onClose={() => setShowBuilder(false)} onCreated={() => { setShowBuilder(false); refresh(); }} />
      )}
    </div>
  );
}
