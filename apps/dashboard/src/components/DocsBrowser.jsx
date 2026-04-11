import { useState, useEffect, useCallback } from 'react';
import { getStoreDocs, getStoreDocDownloadUrl } from '../lib/api';
import './DocsBrowser.css';

const ICONS = {
  folder: '\u{1F4C2}',
  '.pdf': '\u{1F4C4}',
  '.docx': '\u{1F4DD}',
  '.xlsx': '\u{1F4CA}',
  '.csv': '\u{1F4CA}',
  '.png': '\u{1F5BC}',
  '.jpg': '\u{1F5BC}',
  '.jpeg': '\u{1F5BC}',
  '.webp': '\u{1F5BC}',
  '.gif': '\u{1F5BC}',
  default: '\u{1F4C4}',
};

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeNode({ node, storeName, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === 'folder') {
    return (
      <div className="db-node">
        <div className="db-row db-row--folder" style={{ paddingLeft: depth * 16 + 8 }} onClick={() => setOpen(!open)}>
          <span className={`db-arrow${open ? ' db-arrow--open' : ''}`}>{'\u25B6'}</span>
          <span className="db-icon">{ICONS.folder}</span>
          <span className="db-name">{node.name}</span>
          <span className="db-count">{node.children?.length || 0}</span>
        </div>
        {open && node.children?.map((child, i) => (
          <TreeNode key={i} node={child} storeName={storeName} depth={depth + 1} />
        ))}
      </div>
    );
  }

  const icon = ICONS[node.ext] || ICONS.default;
  const downloadUrl = getStoreDocDownloadUrl(storeName, node.path);

  return (
    <a className="db-row db-row--file" style={{ paddingLeft: depth * 16 + 8 }} href={downloadUrl} target="_blank" rel="noopener noreferrer">
      <span className="db-icon">{icon}</span>
      <span className="db-name">{node.name}</span>
      <span className="db-size">{formatSize(node.size)}</span>
    </a>
  );
}

export default function DocsBrowser({ storeName }) {
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    if (!storeName) return;
    setLoading(true);
    try {
      const data = await getStoreDocs(storeName);
      setTree(data.tree || []);
    } catch (err) {
      console.error('[DocsBrowser] Error:', err);
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [storeName]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  if (loading) return (
    <div className="db-section">
      <div className="db-title">Store Documents</div>
      <div className="db-loading">Loading docs...</div>
    </div>
  );

  if (!tree || tree.length === 0) return (
    <div className="db-section">
      <div className="db-title">Store Documents</div>
      <div className="db-empty">No documents found for this store</div>
    </div>
  );

  return (
    <div className="db-section">
      <div className="db-title">Store Documents</div>
      <div className="db-tree">
        {tree.map((node, i) => (
          <TreeNode key={i} node={node} storeName={storeName} />
        ))}
      </div>
    </div>
  );
}
