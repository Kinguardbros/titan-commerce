import { useState, useEffect, useCallback, useRef } from 'react';
import { getProductDetail, updateProductFull } from '../lib/api';
import TagInput from './TagInput';
import VariantEditor from './VariantEditor';
import ImageManager from './ImageManager';
import MetafieldEditor from './MetafieldEditor';
import SizeChartEditor from './SizeChartEditor';
import { useToast } from '../hooks/useToast.jsx';
import './ProductDetail.css';

const STATUS_OPTIONS = ['active', 'draft', 'archived'];

export default function ProductDetail({ product, storeId, store }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [metafields, setMetafields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [seoOpen, setSeoOpen] = useState(false);

  // Inline edit state — always editable
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [productType, setProductType] = useState('');
  const [tags, setTags] = useState([]);
  const [status, setStatus] = useState('active');
  const [variants, setVariants] = useState([]);
  const [images, setImages] = useState([]);
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDesc, setSeoDesc] = useState('');
  const [mf, setMf] = useState([]);

  const hasAdmin = !!(store?.has_admin || store?.admin_token);
  const initialRef = useRef(null);

  const fetchDetail = useCallback(async () => {
    if (!hasAdmin) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await getProductDetail(storeId, product.id);
      const d = data.product;
      setDetail(d);
      setDbOnly(!!data.db_only);
      setMetafields(data.metafields || []);
      // Populate edit state
      setTitle(d?.title || '');
      setDescription(d?.body_html || '');
      setVendor(d?.vendor || '');
      setProductType(d?.product_type || '');
      setTags(d?.tags ? d.tags.split(',').map((t) => t.trim()).filter(Boolean) : []);
      setStatus(d?.status || 'active');
      setVariants(d?.variants ? d.variants.map((v) => ({ ...v })) : []);
      setImages(d?.images ? d.images.map((img) => ({ ...img })) : []);
      setSeoTitle(d?.metafields_global_title_tag || '');
      setSeoDesc(d?.metafields_global_description_tag || '');
      setMf((data.metafields || []).map((m) => ({ ...m })));
      initialRef.current = {
        title: d?.title, description: d?.body_html, vendor: d?.vendor,
        productType: d?.product_type, tags: d?.tags, status: d?.status,
        seoTitle: d?.metafields_global_title_tag, seoDesc: d?.metafields_global_description_tag,
      };
      setDirty(false);
    } catch (err) {
      console.error('[ProductDetail] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [storeId, product.id, hasAdmin]);

  useEffect(() => { fetchDetail(); }, [fetchDetail]);

  // Track dirty
  const markDirty = () => { if (!dirty) setDirty(true); };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = {
        title, body_html: description, vendor, product_type: productType,
        tags: tags.join(', '), status,
        seo_title: seoTitle, seo_description: seoDesc,
        variants: variants.filter((v) => v._dirty).map((v) => ({
          id: v.id, price: v.price, compare_at_price: v.compare_at_price, sku: v.sku,
        })),
        images: images.map((img, i) => ({ id: img.id, position: i + 1 })),
        metafields: mf.filter((m) => m._dirty).map((m) => ({
          namespace: m.namespace, key: m.key, value: m.value, type: m.type || 'single_line_text_field',
        })),
      };
      await updateProductFull(storeId, product.id, updates);
      toast.success('Product saved!');
      setDirty(false);
      fetchDetail();
    } catch (err) {
      console.error('[ProductDetail] Save error:', err);
      toast.error(`Save failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (!detail) return;
    setTitle(detail.title || '');
    setDescription(detail.body_html || '');
    setVendor(detail.vendor || '');
    setProductType(detail.product_type || '');
    setTags(detail.tags ? detail.tags.split(',').map((t) => t.trim()).filter(Boolean) : []);
    setStatus(detail.status || 'active');
    setVariants(detail.variants ? detail.variants.map((v) => ({ ...v })) : []);
    setImages(detail.images ? detail.images.map((img) => ({ ...img })) : []);
    setSeoTitle(detail.metafields_global_title_tag || '');
    setSeoDesc(detail.metafields_global_description_tag || '');
    setMf(metafields.map((m) => ({ ...m })));
    setDirty(false);
  };

  const [dbOnly, setDbOnly] = useState(false);

  if (!hasAdmin) return null;
  if (loading) return <div className="pd-loading">Loading product details...</div>;
  if (!detail) return <div className="pd-empty">Could not load product details from Shopify</div>;

  const statusColor = status === 'active' ? 'pd-status--active' : status === 'draft' ? 'pd-status--draft' : 'pd-status--archived';
  const handle = detail.handle || '';

  return (
    <div className="pd">
      {dbOnly && (
        <div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: 'rgba(251,191,36,0.9)', fontSize: 12, fontFamily: 'var(--mono)' }}>
          This product was deleted from Shopify — showing cached data. Editing is disabled.
        </div>
      )}
      {/* ══ TWO-COLUMN LAYOUT ══ */}
      <div className="pd-columns">

        {/* LEFT COLUMN (65%) */}
        <div className="pd-left">

          {/* Title */}
          <div className="pd-card">
            <div className="pd-field-label">Title</div>
            <input className="pd-input pd-input--title" value={title}
              onChange={(e) => { setTitle(e.target.value); markDirty(); }} />
          </div>

          {/* Description */}
          <div className="pd-card">
            <div className="pd-field-label">Description</div>
            <div className="pd-desc-toolbar">
              <button className="pd-toolbar-btn" title="Bold" onClick={() => { setDescription((d) => d + '<strong></strong>'); markDirty(); }}><b>B</b></button>
              <button className="pd-toolbar-btn" title="Italic" onClick={() => { setDescription((d) => d + '<em></em>'); markDirty(); }}><i>I</i></button>
              <button className="pd-toolbar-btn" title="Underline" onClick={() => { setDescription((d) => d + '<u></u>'); markDirty(); }}><u>U</u></button>
              <span className="pd-toolbar-sep" />
              <button className="pd-toolbar-btn" title="List" onClick={() => { setDescription((d) => d + '\n<ul>\n<li></li>\n</ul>'); markDirty(); }}>List</button>
              <button className="pd-toolbar-btn" title="Link" onClick={() => { setDescription((d) => d + '<a href=""></a>'); markDirty(); }}>Link</button>
            </div>
            <textarea className="pd-textarea pd-textarea--desc" rows={10} value={description}
              onChange={(e) => { setDescription(e.target.value); markDirty(); }} />
          </div>

          {/* Media */}
          <div className="pd-card">
            <div className="pd-field-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              Media
              <button onClick={() => { fetchDetail(); toast.info('Media refreshed'); }} title="Refresh images from Shopify"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 14, padding: '2px 6px' }}>↻</button>
            </div>
            <ImageManager images={images} editing onChange={(imgs) => { setImages(imgs); markDirty(); }} />
          </div>

        </div>

        {/* RIGHT COLUMN (35%) */}
        <div className="pd-right">

          {/* Status */}
          <div className="pd-card">
            <div className="pd-field-label">Status</div>
            <select className={`pd-select pd-select--status ${statusColor}`} value={status}
              onChange={(e) => { setStatus(e.target.value); markDirty(); }}>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {/* Product organization */}
          <div className="pd-card">
            <div className="pd-card-heading">Product organization</div>
            <div className="pd-org-field">
              <div className="pd-field-label">Product type</div>
              <input className="pd-input" value={productType}
                onChange={(e) => { setProductType(e.target.value); markDirty(); }} placeholder="e.g. Swimsuit" />
            </div>
            <div className="pd-org-field">
              <div className="pd-field-label">Vendor</div>
              <input className="pd-input" value={vendor}
                onChange={(e) => { setVendor(e.target.value); markDirty(); }} placeholder="e.g. Elegance House" />
            </div>
            <div className="pd-org-field">
              <div className="pd-field-label">Tags</div>
              <TagInput tags={tags} onChange={(t) => { setTags(t); markDirty(); }} />
            </div>
          </div>

        </div>
      </div>

      {/* ══ FULL-WIDTH SECTIONS ══ */}

      {/* Variants */}
      <div className="pd-card">
        <div className="pd-card-header-row">
          <div className="pd-card-heading">Variants</div>
          <span className="pd-variant-count">{variants.length} variant{variants.length !== 1 ? 's' : ''}</span>
        </div>
        <VariantEditor variants={variants} options={detail.options} editing
          onChange={(v) => { setVariants(v); markDirty(); }} />
      </div>

      {/* Size Chart */}
      <SizeChartEditor product={product} storeId={storeId} />

      {/* Metafields */}
      <div className="pd-card">
        <div className="pd-card-heading">Metafields</div>
        <MetafieldEditor metafields={mf} editing onChange={(m) => { setMf(m); markDirty(); }} />
      </div>

      {/* SEO */}
      <div className="pd-card">
        <div className="pd-card-header-row">
          <div className="pd-card-heading">Search engine listing</div>
          <button className="pd-edit-btn" onClick={() => setSeoOpen(!seoOpen)}>{seoOpen ? 'Close' : 'Edit'}</button>
        </div>
        <div className="pd-seo-preview">
          <div className="pd-seo-title">{seoTitle || title || 'Page title'}</div>
          <div className="pd-seo-url">{store?.shopify_url ? `https://${store.shopify_url}` : 'https://store.myshopify.com'} &rsaquo; products &rsaquo; {handle}</div>
          <div className="pd-seo-desc">{seoDesc || description?.replace(/<[^>]*>/g, '').slice(0, 155) || 'No description'}</div>
        </div>
        {seoOpen && (
          <div className="pd-seo-edit">
            <div className="pd-org-field">
              <div className="pd-field-label">Meta title <span className="pd-char-hint">{seoTitle.length}/70</span></div>
              <input className="pd-input" value={seoTitle} onChange={(e) => { setSeoTitle(e.target.value); markDirty(); }} maxLength={70} />
            </div>
            <div className="pd-org-field">
              <div className="pd-field-label">Meta description <span className="pd-char-hint">{seoDesc.length}/160</span></div>
              <textarea className="pd-textarea" rows={3} value={seoDesc} onChange={(e) => { setSeoDesc(e.target.value); markDirty(); }} maxLength={160} />
            </div>
          </div>
        )}
      </div>

      {/* Sticky save bar */}
      {dirty && (
        <div className="pd-save-bar">
          <div className="pd-save-bar-inner">
            <span className="pd-save-bar-text">Unsaved changes</span>
            <button className="pd-discard-btn" onClick={handleDiscard}>Discard</button>
            <button className="pd-save-btn" onClick={handleSave} disabled={saving || dbOnly}>{saving ? 'Saving...' : dbOnly ? 'Read-only' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
