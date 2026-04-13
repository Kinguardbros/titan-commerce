import { createClient } from '@supabase/supabase-js';
import { getStore } from '../store-context.js';
import { extractText, classifyDocument, extractInsights, identifyProduct } from '../doc-processor.js';
import { upsertSkill } from './skills.js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DOCS_BUCKET = 'store-docs';

// GET: store_docs
export async function store_docs(req, res) {
  const storeName = req.query.store_name;
  if (!storeName) return res.status(400).json({ error: 'store_name required' });

  async function listRecursive(prefix) {
    const { data, error } = await supabase.storage.from(DOCS_BUCKET).list(prefix, { sortBy: { column: 'name', order: 'asc' } });
    if (error || !data) return [];
    const items = [];
    for (const item of data) {
      if (item.name === '.emptyFolderPlaceholder') continue;
      const itemPath = prefix ? `${prefix}${item.name}` : item.name;
      if (item.id === null) {
        // folder
        const children = await listRecursive(`${itemPath}/`);
        items.push({ name: item.name, type: 'folder', path: itemPath, children });
      } else {
        const ext = item.name.includes('.') ? '.' + item.name.split('.').pop().toLowerCase() : '';
        items.push({ name: item.name, type: 'file', path: itemPath, ext, size: item.metadata?.size || 0 });
      }
    }
    // Sort: folders first, then files
    items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1);
    return items;
  }

  const tree = await listRecursive(`${storeName}/`);
  return res.status(200).json({ tree });
}

// GET: store_docs_download
export async function store_docs_download(req, res) {
  const storeName = req.query.store_name;
  const filePath = req.query.file_path;
  if (!storeName || !filePath) return res.status(400).json({ error: 'store_name and file_path required' });

  // Path traversal check
  if (filePath.includes('..')) return res.status(403).json({ error: 'Access denied' });

  const fullPath = `${storeName}/${filePath}`;
  const { data } = supabase.storage.from(DOCS_BUCKET).getPublicUrl(fullPath);
  return res.status(200).json({ url: data?.publicUrl });
}

// POST: upload_store_doc
export async function upload_store_doc(req, res) {
  const { store_name, store_id, file_name, file_data, auto_process } = req.body;
  if (!store_name || !file_name || !file_data) return res.status(400).json({ error: 'store_name, file_name, and file_data (base64) required' });

  // Validate extension
  const allowed = ['.pdf', '.docx', '.png', '.jpg', '.jpeg', '.txt', '.md', '.xlsx', '.csv', '.webp'];
  const ext = file_name.includes('.') ? '.' + file_name.split('.').pop().toLowerCase() : '';
  if (!allowed.includes(ext)) return res.status(400).json({ error: `File type ${ext} not allowed` });

  // Sanitize filename
  const safeName = file_name.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  if (safeName.includes('..')) return res.status(403).json({ error: 'Access denied' });

  const storagePath = `${store_name}/Inbox/${safeName}`;
  const buffer = Buffer.from(file_data, 'base64');

  const { error } = await supabase.storage.from(DOCS_BUCKET).upload(storagePath, buffer, {
    upsert: true,
    contentType: 'application/octet-stream',
  });

  if (error) {
    console.error('[system/upload_store_doc] Storage error:', error);
    return res.status(500).json({ error: `Upload failed: ${error.message}` });
  }

  // Auto-process this single file if requested
  if (auto_process !== false && store_id) {
    try {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      const text = await extractText(buffer, safeName, anthropic);
      if (text) {
        const category = await classifyDocument(text, safeName, anthropic);

        // Dedup: if same filename exists in category, rename new file with timestamp
        const nameBase = safeName.includes('.') ? safeName.slice(0, safeName.lastIndexOf('.')) : safeName;
        const nameExt = safeName.includes('.') ? safeName.slice(safeName.lastIndexOf('.')) : '';
        const { data: existingFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${store_name}/${category}`);
        const destName = existingFiles?.some((f) => f.name === safeName)
          ? `${nameBase}_${Date.now()}${nameExt}` : safeName;

        // Move to category folder
        const destPath = `${store_name}/${category}/${destName}`;
        await supabase.storage.from(DOCS_BUCKET).upload(destPath, buffer, { upsert: true });
        await supabase.storage.from(DOCS_BUCKET).remove([storagePath]);

        // Extract insights
        let insightsText = '';
        let insightsCount = 0;
        if (category !== 'Logos' && text.length > 50) {
          insightsText = await extractInsights(text, safeName, store_name, anthropic);
          insightsCount = (insightsText.match(/^[-•*]/gm) || []).length;
          await supabase.from('store_knowledge').insert({
            store_id, source_file: safeName, category, insights: insightsText,
          });
        }

        // Pipeline log
        await supabase.from('pipeline_log').insert({
          store_id, agent: 'DOC_PROCESSOR',
          message: `Auto-processed "${safeName}" → ${category}`,
          level: 'info', metadata: { filename: safeName, category, insights_count: insightsCount },
        });

        return res.status(200).json({
          ok: true, auto_processed: true,
          filename: safeName, category, insights_count: insightsCount, size: buffer.length,
        });
      }
    } catch (procErr) {
      console.error('[upload_store_doc] Auto-process error:', procErr.message);
      // File is uploaded but processing failed — it stays in Inbox
      await supabase.from('pipeline_log').insert({
        store_id, agent: 'DOC_PROCESSOR',
        message: `Auto-process failed for "${safeName}": ${procErr.message}`,
        level: 'error',
      });
    }
  }

  return res.status(200).json({ ok: true, auto_processed: false, path: `Inbox/${safeName}`, size: buffer.length });
}

// POST: process_single_file
export async function process_single_file(req, res) {
  const { store_id, filename } = req.body;
  if (!store_id || !filename) return res.status(400).json({ error: 'store_id and filename required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const storeName = store.name;
  const filePath = `${storeName}/Inbox/${filename}`;

  const { data: fileData, error: dlErr } = await supabase.storage.from(DOCS_BUCKET).download(filePath);
  if (dlErr || !fileData) return res.status(404).json({ error: `File not found: ${filename}` });

  const buffer = await fileData.arrayBuffer();

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const text = await extractText(buffer, filename, anthropic);
  if (!text) return res.status(200).json({ filename, category: null, error: 'Unsupported format' });

  const category = await classifyDocument(text, filename, anthropic);

  // Product identification for Products category
  let productName = null;
  if (category === 'Products') {
    productName = await identifyProduct(text, filename, anthropic);
  }

  // Dedup: rename if same name exists in target folder
  const fBase = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
  const fExt = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const targetFolder = category === 'Products' && productName && productName !== 'General'
    ? `${storeName}/Products/${productName}` : `${storeName}/${category}`;
  const { data: existFiles } = await supabase.storage.from(DOCS_BUCKET).list(targetFolder);
  const destName = existFiles?.some((f) => f.name === filename) ? `${fBase}_${Date.now()}${fExt}` : filename;

  // Move
  const destPath = `${targetFolder}/${destName}`;
  await supabase.storage.from(DOCS_BUCKET).upload(destPath, Buffer.from(buffer), { upsert: true });
  await supabase.storage.from(DOCS_BUCKET).remove([filePath]);

  // Extract insights
  let insightsCount = 0;
  if (category !== 'Logos' && text.length > 50) {
    const insightsText = await extractInsights(text, filename, storeName, anthropic);
    insightsCount = (insightsText.match(/^[-•*]/gm) || []).length;
    await supabase.from('store_knowledge').insert({
      store_id, source_file: destName, category, insights: insightsText,
      product_name: productName && productName !== 'General' ? productName : null,
    });
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'DOC_PROCESSOR',
    message: `Processed "${filename}" → ${category}${productName ? ` (${productName})` : ''}`,
    level: 'info', metadata: { filename: destName, category, product_name: productName, insights_count: insightsCount },
  });

  return res.status(200).json({ filename, category, product_name: productName, insights_count: insightsCount });
}

// POST: process_inbox
export async function process_inbox(req, res) {
  const { store_id } = req.body;
  if (!store_id) return res.status(400).json({ error: 'store_id required' });

  const store = await getStore(store_id);
  if (!store) return res.status(404).json({ error: 'Store not found' });

  const storeName = store.name;

  // List inbox files
  const { data: inboxFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${storeName}/Inbox`, { sortBy: { column: 'name', order: 'asc' } });
  const files = (inboxFiles || []).filter((f) => f.id !== null && f.name !== '.emptyFolderPlaceholder');

  if (files.length === 0) return res.status(200).json({ processed: 0, message: 'Inbox is empty', results: [] });

  // Process in batches of 10 to stay within Vercel timeout
  const batch = files.slice(0, 20);
  const remaining = files.length - batch.length;
  const files_to_process = batch;

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const results = [];
  for (const file of files_to_process) {
    try {
      // Download
      const filePath = `${storeName}/Inbox/${file.name}`;
      const { data: fileData, error: dlErr } = await supabase.storage.from(DOCS_BUCKET).download(filePath);
      if (dlErr || !fileData) { results.push({ filename: file.name, error: 'Download failed' }); continue; }
      const buffer = await fileData.arrayBuffer();

      // Extract text
      const text = await extractText(buffer, file.name, anthropic);
      if (!text) { results.push({ filename: file.name, error: 'Unsupported format' }); continue; }

      // Classify
      const category = await classifyDocument(text, file.name, anthropic);

      // Dedup: if same filename exists in category, rename with timestamp
      const fBase = file.name.includes('.') ? file.name.slice(0, file.name.lastIndexOf('.')) : file.name;
      const fExt = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
      const { data: existFiles } = await supabase.storage.from(DOCS_BUCKET).list(`${storeName}/${category}`);
      const destFileName = existFiles?.some((f) => f.name === file.name)
        ? `${fBase}_${Date.now()}${fExt}` : file.name;

      // Move file: copy to category folder, delete from Inbox
      const destPath = `${storeName}/${category}/${destFileName}`;
      await supabase.storage.from(DOCS_BUCKET).upload(destPath, Buffer.from(buffer), { upsert: true });
      await supabase.storage.from(DOCS_BUCKET).remove([filePath]);

      // Extract insights (skip for logos/images with no meaningful text)
      let insightsText = '';
      let insightsCount = 0;
      if (category !== 'Logos' && text.length > 50) {
        insightsText = await extractInsights(text, file.name, storeName, anthropic);
        insightsCount = (insightsText.match(/^[-•*]/gm) || []).length;

        // Save to store_knowledge
        await supabase.from('store_knowledge').insert({
          store_id, source_file: file.name, category, insights: insightsText,
        });
      }

      results.push({ filename: file.name, category, insights_count: insightsCount });
    } catch (err) {
      console.error(`[process_inbox] Error processing ${file.name}:`, err.message);
      results.push({ filename: file.name, error: err.message });
    }
  }

  const successCount = results.filter((r) => !r.error).length;
  await supabase.from('pipeline_log').insert({
    store_id, agent: 'DOC_PROCESSOR',
    message: `Processed ${successCount}/${files.length} files from Inbox`,
    level: successCount > 0 ? 'success' : 'error',
    metadata: { results },
  });

  return res.status(200).json({
    processed: successCount, results, remaining,
    message: remaining > 0 ? `${remaining} file(s) still in Inbox — run again` : undefined,
  });
}
