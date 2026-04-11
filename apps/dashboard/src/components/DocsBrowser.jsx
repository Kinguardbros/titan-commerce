import { useState, useEffect, useCallback, useRef } from 'react';
import { getStoreDocs, getStoreDocDownloadUrl, uploadStoreDoc, processInbox } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
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
  '.txt': '\u{1F4C3}',
  '.md': '\u{1F4C3}',
  default: '\u{1F4C4}',
};

const ALLOWED_EXTS = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.txt', '.md', '.xlsx', '.csv', '.webp'];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TreeNode({ node, storeName, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0);

  if (node.type === 'folder') {
    const isInbox = node.name === 'Inbox';
    return (
      <div className="db-node">
        <div className="db-row db-row--folder" style={{ paddingLeft: depth * 16 + 8 }} onClick={() => setOpen(!open)}>
          <span className={`db-arrow${open ? ' db-arrow--open' : ''}`}>{'\u25B6'}</span>
          <span className="db-icon">{ICONS.folder}</span>
          <span className="db-name">{node.name}</span>
          <span className={`db-count${isInbox && node.children?.length > 0 ? ' db-count--new' : ''}`}>
            {node.children?.length || 0}{isInbox && node.children?.length > 0 ? ' new' : ''}
          </span>
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

export default function DocsBrowser({ storeName, storeId }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [tree, setTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState(null);
  const dragCounter = useRef(0);

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

  const uploadFiles = async (files) => {
    const valid = Array.from(files).filter((f) => {
      const ext = '.' + f.name.split('.').pop().toLowerCase();
      return ALLOWED_EXTS.includes(ext);
    });
    if (valid.length === 0) {
      toast.error('No supported files. Allowed: PDF, DOCX, PNG, JPG, TXT, MD');
      return;
    }

    setUploading(true);
    let uploaded = 0;
    for (const file of valid) {
      // Auto-process only the first file (sync), rest just upload to Inbox
      const isFirst = uploaded === 0;
      setUploadProgress(isFirst
        ? `Uploading & processing ${file.name}...`
        : `Uploading ${file.name} (${uploaded + 1}/${valid.length})...`);
      try {
        const base64 = await fileToBase64(file);
        const result = await uploadStoreDoc(storeName, file.name, base64, storeId, isFirst);
        uploaded++;
        if (result.auto_processed) {
          toast.success(`${file.name} → ${result.category} (${result.insights_count} insights)`);
        } else {
          toast.success(`Uploaded ${file.name} to Inbox`);
        }
      } catch (err) {
        console.error('[DocsBrowser] Upload error:', err);
        toast.error(`Upload failed: ${file.name} — ${err.message}`);
      }
    }
    if (valid.length > 1) {
      const remaining = valid.length - 1;
      toast.info(`${remaining} file${remaining > 1 ? 's' : ''} remaining in Inbox — click Process Inbox`);
    }
    setUploading(false);
    setUploadProgress('');
    fetchDocs();
  };

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      // Remove data URL prefix to get raw base64
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const handleDragEnter = (e) => {
    e.preventDefault();
    dragCounter.current++;
    setDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current === 0) setDragging(false);
  };
  const handleDragOver = (e) => { e.preventDefault(); };
  const handleDrop = (e) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files?.length > 0) uploadFiles(e.dataTransfer.files);
  };
  const handleFileSelect = (e) => {
    if (e.target.files?.length > 0) uploadFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Count inbox files
  const inboxNode = tree?.find((n) => n.type === 'folder' && n.name === 'Inbox');
  const inboxCount = inboxNode?.children?.length || 0;

  const handleProcess = async () => {
    if (!storeId) return;
    setProcessing(true);
    setProcessResult(null);
    try {
      const result = await processInbox(storeId);
      setProcessResult(result);
      if (result.processed > 0) {
        const totalInsights = result.results.reduce((s, r) => s + (r.insights_count || 0), 0);
        toast.success(`Processed ${result.processed} files, ${totalInsights} insights extracted`);
      } else {
        toast.info(result.message || 'No files to process');
      }
      fetchDocs();
    } catch (err) {
      console.error('[DocsBrowser] Process error:', err);
      toast.error(`Process failed: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="db-section">
      <div className="db-title">Store Documents</div>

      {/* Drop zone */}
      <div
        className={`db-dropzone${dragging ? ' db-dropzone--active' : ''}${uploading ? ' db-dropzone--uploading' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {uploading ? (
          <div className="db-drop-text">{uploadProgress}</div>
        ) : (
          <>
            <div className="db-drop-icon">{'\u{1F4E5}'}</div>
            <div className="db-drop-text">Drag & drop files to Inbox</div>
            <button className="db-drop-browse" onClick={() => fileRef.current?.click()}>Browse files</button>
            <div className="db-drop-hint">PDF, DOCX, PNG, JPG, TXT, MD</div>
          </>
        )}
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.md,.xlsx,.csv,.webp" style={{ display: 'none' }} onChange={handleFileSelect} />
      </div>

      {/* Process Inbox */}
      {inboxCount > 0 && !loading && (
        <div className="db-process-bar">
          <span className="db-process-info">{inboxCount} file{inboxCount !== 1 ? 's' : ''} in Inbox</span>
          <button className="db-process-btn" onClick={handleProcess} disabled={processing}>
            {processing ? 'Processing...' : 'Process Inbox'}
          </button>
        </div>
      )}

      {/* Process result */}
      {processResult && processResult.results?.length > 0 && (
        <div className="db-process-result">
          {processResult.results.map((r, i) => (
            <div key={i} className={`db-process-item${r.error ? ' db-process-item--error' : ''}`}>
              <span>{r.error ? '\u2717' : '\u2713'}</span>
              <span className="db-process-filename">{r.filename}</span>
              {r.category && <span className="db-process-category">{r.category}</span>}
              {r.insights_count > 0 && <span className="db-process-insights">{r.insights_count} insights</span>}
              {r.error && <span className="db-process-error">{r.error}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Tree */}
      {loading ? (
        <div className="db-loading">Loading docs...</div>
      ) : tree && tree.length > 0 ? (
        <div className="db-tree">
          {tree.map((node, i) => (
            <TreeNode key={i} node={node} storeName={storeName} />
          ))}
        </div>
      ) : (
        <div className="db-empty">No documents found for this store</div>
      )}
    </div>
  );
}
