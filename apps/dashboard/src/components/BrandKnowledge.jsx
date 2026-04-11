import { useState } from 'react';
import { generateSkill } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './BrandKnowledge.css';

export default function BrandKnowledge({ storeId, storeName }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const result = await generateSkill(storeId);
      setData(result);
      if (!result.markdown) {
        toast.info('No documents processed yet — upload docs to Inbox first');
      }
    } catch (err) {
      console.error('[BrandKnowledge] Error:', err);
      toast.error(`Failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    if (!data?.markdown) return;
    const blob = new Blob([data.markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${storeName || 'store'}_brand_knowledge.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Exported as Markdown');
  };

  return (
    <div className="bk-section">
      <div className="bk-header">
        <div className="bk-title">Brand Knowledge</div>
        <button className="bk-generate-btn" onClick={handleGenerate} disabled={loading}>
          {loading ? 'Generating...' : data ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {!data && !loading && (
        <div className="bk-empty">
          Click Generate to compile brand knowledge from processed documents
        </div>
      )}

      {data?.markdown && (
        <>
          <div className="bk-stats">
            <span>Generated from {data.doc_count} document{data.doc_count !== 1 ? 's' : ''}, {data.insight_count} insights</span>
            <button className="bk-export-btn" onClick={handleExport}>Export MD</button>
          </div>

          <div className={`bk-content${expanded ? '' : ' bk-content--collapsed'}`}>
            <div className="bk-markdown" dangerouslySetInnerHTML={{ __html: markdownToHtml(data.markdown) }} />
          </div>

          {!expanded && (
            <button className="bk-expand-btn" onClick={() => setExpanded(true)}>View full document</button>
          )}
        </>
      )}
    </div>
  );
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
