import { useState, useEffect, useCallback } from 'react';
import { getSkills, generateSkills, regenerateSkill } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './BrandKnowledge.css';

const SKILL_ICONS = {
  'ad-hooks': '\u{1F3AF}',
  'creative-direction': '\u{1F3A8}',
  'audience-personas': '\u{1F465}',
  'brand-voice': '\u{1F4AC}',
};

const SKILL_DESCRIPTIONS = {
  'ad-hooks': 'Winning hooks, ad copy patterns, CTA styles',
  'creative-direction': 'Visual rules, testing framework, KPI benchmarks',
  'audience-personas': 'Personas, pain points, triggers, customer language',
  'brand-voice': 'Positioning, tone rules, messaging do/don\'t',
};

export default function BrandKnowledge({ storeId, storeName }) {
  const toast = useToast();
  const [skills, setSkills] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(null);
  const [expandedSkill, setExpandedSkill] = useState(null);

  const fetchSkills = useCallback(async () => {
    if (!storeId) return;
    try {
      const data = await getSkills(storeId);
      setSkills(data.skills || []);
      setCategories(data.available_categories || []);
    } catch (err) {
      console.error('[BrandKnowledge] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const handleGenerateAll = async () => {
    setGenerating(true);
    try {
      const result = await generateSkills(storeId);
      toast.success(`Generated ${result.generated} skills`);
      fetchSkills();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async (skillType, productName) => {
    setRegenerating(skillType);
    try {
      await regenerateSkill(storeId, skillType, productName);
      toast.success(`Regenerated ${productName || skillType}`);
      fetchSkills();
    } catch (err) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setRegenerating(null);
    }
  };

  const handleExport = (skill) => {
    const blob = new Blob([`# ${skill.title}\n\n${skill.content}`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${storeName || 'store'}_${skill.skill_type}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return null;

  const storeSkills = skills.filter((s) => !s.product_name);
  const productSkills = skills.filter((s) => !!s.product_name);
  const totalSources = skills.reduce((s, sk) => s + (sk.source_count || 0), 0);

  return (
    <div className="bk-section">
      <div className="bk-header">
        <div>
          <div className="bk-title">Skills</div>
          {skills.length > 0 && (
            <div className="bk-subtitle">{skills.length} skills from {totalSources} documents</div>
          )}
        </div>
        {categories.length > 0 && (
          <button className="bk-generate-btn" onClick={handleGenerateAll} disabled={generating}>
            {generating ? 'Generating...' : skills.length > 0 ? 'Regenerate All' : 'Generate Skills'}
          </button>
        )}
      </div>

      {skills.length === 0 && categories.length === 0 && (
        <div className="bk-empty">Upload documents to Inbox and process them to generate brand knowledge</div>
      )}

      {skills.length === 0 && categories.length > 0 && (
        <div className="bk-empty">
          {categories.length} document categories available. Click Generate Skills to compile.
        </div>
      )}

      {/* Store-level skills */}
      {storeSkills.length > 0 && (
        <div className="bk-cards">
          {storeSkills.map((skill) => (
            <SkillCard key={skill.skill_type} skill={skill}
              expanded={expandedSkill === skill.skill_type}
              regenerating={regenerating === skill.skill_type}
              onToggle={() => setExpandedSkill(expandedSkill === skill.skill_type ? null : skill.skill_type)}
              onRegenerate={() => handleRegenerate(skill.skill_type, null)}
              onExport={() => handleExport(skill)} />
          ))}
        </div>
      )}

      {/* Product-level skills */}
      {productSkills.length > 0 && (
        <>
          <div className="bk-product-heading">Product Skills</div>
          <div className="bk-cards">
            {productSkills.map((skill) => (
              <SkillCard key={skill.skill_type} skill={skill} isProduct
                expanded={expandedSkill === skill.skill_type}
                regenerating={regenerating === skill.skill_type}
                onToggle={() => setExpandedSkill(expandedSkill === skill.skill_type ? null : skill.skill_type)}
                onRegenerate={() => handleRegenerate(skill.skill_type, skill.product_name)}
                onExport={() => handleExport(skill)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SkillCard({ skill, expanded, regenerating, onToggle, onRegenerate, onExport, isProduct }) {
  const icon = isProduct ? '\u{1F4E6}' : (SKILL_ICONS[skill.skill_type] || '\u{1F4CB}');
  const desc = isProduct ? `Product-specific knowledge` : (SKILL_DESCRIPTIONS[skill.skill_type] || '');
  const age = getTimeAgo(skill.generated_at);

  return (
    <div className="bk-card">
      <div className="bk-card-header">
        <div className="bk-card-left">
          <span className="bk-card-icon">{icon}</span>
          <div>
            <div className="bk-card-title">{skill.title}</div>
            <div className="bk-card-desc">{desc}</div>
          </div>
        </div>
        <div className="bk-card-actions">
          <button className="bk-card-btn" onClick={onToggle}>{expanded ? 'Close' : 'View'}</button>
          <button className="bk-card-btn" onClick={onRegenerate} disabled={regenerating}>{regenerating ? '...' : 'Regen'}</button>
          <button className="bk-card-btn" onClick={onExport}>MD</button>
        </div>
      </div>
      <div className="bk-card-meta">
        <span>{skill.source_count} source{skill.source_count !== 1 ? 's' : ''}</span>
        <span>{age}</span>
      </div>
      {expanded && (
        <div className="bk-card-content">
          <div className="bk-markdown" dangerouslySetInnerHTML={{ __html: markdownToHtml(skill.content) }} />
        </div>
      )}
    </div>
  );
}

function getTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function markdownToHtml(md) {
  return md
    .replace(/^## (.+)$/gm, '<h3 class="bk-h3">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="bk-h4">$1</h4>')
    .replace(/^# (.+)$/gm, '<h2 class="bk-h2">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^[-•*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/\n{2,}/g, '<br/><br/>')
    .replace(/\n/g, '<br/>');
}
