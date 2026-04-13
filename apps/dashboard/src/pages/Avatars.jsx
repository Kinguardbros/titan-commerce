import { useState, useEffect } from 'react';
import { getAvatars, getSkills, generateAvatar } from '../lib/api';
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

  const refresh = () => {
    getAvatars(storeId).then(data => setAvatars(data || [])).catch(() => {});
  };

  if (loading) return <div className="av-loading">Loading avatars...</div>;

  return (
    <div className="av-page">
      <div className="av-header">
        <div>
          <div className="av-title">Avatar Studio</div>
          <div className="av-subtitle">Manage model references for consistent product photos</div>
        </div>
        <button className="av-create-btn" onClick={() => setShowBuilder(true)}>+ Create New</button>
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
