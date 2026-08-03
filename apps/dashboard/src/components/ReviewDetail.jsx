import { useState, useRef } from 'react';
import { uploadReviewPhoto, deleteReviewPhoto } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';

// A photo only needs cleanup if it was uploaded THIS session (not the review's saved one).
function cleanupOrphan(url, savedUrl) {
  if (url && url !== savedUrl) deleteReviewPhoto(url).catch(() => {});
}

const EMPTY = { author: '', rating: 5, title: '', body: '', review_date: '', photo_urls: [], verified: false, helpful_count: 0 };

// Normalize incoming review to F08 photo_urls array (legacy photo_url still works).
function initialPhotos(review) {
  if (!review) return [];
  if (Array.isArray(review.photo_urls) && review.photo_urls.length > 0) return review.photo_urls;
  if (review.photo_url) return [review.photo_url];
  return [];
}

const MAX_PHOTOS = 10;

// Right-side detail panel — edit an existing review or fill in a new manual one.
// Photo upload (Phase 4) stores to Supabase Storage and sets photo_urls on the form.
// F08 multi-photo: up to 10 photos per review, uploaded one at a time, gallery preview.
export default function ReviewDetail({ review, isNew, saving, storeId, productId, onSave, onApprove, onReject, onDelete, onClose }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState(() => ({
    author: review?.author || '',
    rating: review?.rating || 5,
    title: review?.title || '',
    body: review?.body || '',
    review_date: review?.review_date || new Date().toISOString().slice(0, 10),
    photo_urls: initialPhotos(review),
    verified: !!review?.verified,
    helpful_count: review?.helpful_count || 0,
  }));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.author.trim() && form.body.trim();
  const savedPhotos = new Set(initialPhotos(review)); // persisted URLs — never clean up these

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (form.photo_urls.length >= MAX_PHOTOS) {
      toast.error(`Max ${MAX_PHOTOS} photos per review`);
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error('Could not read image');
    reader.onload = async () => {
      const base64 = String(reader.result).split(',')[1];
      setUploading(true);
      try {
        const { photo_url } = await uploadReviewPhoto(storeId, productId, base64, file.type);
        setForm((f) => ({ ...f, photo_urls: [...f.photo_urls, photo_url] }));
        toast.success('Photo uploaded');
      } catch (err) {
        console.error('[ReviewDetail] photo upload failed:', err);
        toast.error(`Upload failed: ${err.message}`);
      } finally {
        setUploading(false);
        e.target.value = ''; // allow re-uploading the same file
      }
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = (url) => {
    cleanupOrphan(url, savedPhotos.has(url) ? url : ''); // if it was newly uploaded, delete it
    setForm((f) => ({ ...f, photo_urls: f.photo_urls.filter((u) => u !== url) }));
  };

  // Save posts photo_urls array + photo_url mirror (first) for backward compat with
  // callers/renders that still read the legacy single field.
  const handleSave = () => {
    onSave({ ...form, photo_url: form.photo_urls[0] || '' });
  };

  return (
    <div className="rv-detail">
      <div className="rv-detail-head">
        <div className="rv-detail-title">{isNew ? 'New Review' : 'Edit Review'}</div>
        <button className="rv-detail-close" aria-label="Close detail" onClick={onClose}>✕</button>
      </div>

      <div className="rv-detail-body">
        <label className="rv-field-label">Author</label>
        <input className="rv-input" value={form.author} onChange={(e) => set('author', e.target.value)}
          placeholder="e.g. Maria K." />

        <label className="rv-field-label">Rating</label>
        <div className="rv-rating-picker">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button"
              className={`rv-star-btn${n <= form.rating ? ' rv-star-btn--on' : ''}`}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              onClick={() => set('rating', n)}>★</button>
          ))}
        </div>

        <label className="rv-field-label">Title</label>
        <input className="rv-input" value={form.title} onChange={(e) => set('title', e.target.value)}
          placeholder="Short headline (optional)" />

        <label className="rv-field-label">Body</label>
        <textarea className="rv-textarea" value={form.body} onChange={(e) => set('body', e.target.value)}
          rows={5} placeholder="Review text" />

        <label className="rv-field-label">Review date</label>
        <input className="rv-input" type="date" value={form.review_date || ''}
          onChange={(e) => set('review_date', e.target.value)} />

        <label className="rv-toggle">
          <input type="checkbox" checked={form.verified} onChange={(e) => set('verified', e.target.checked)} />
          <span>✓ Verified purchase</span>
        </label>

        <label className="rv-field-label">Helpful count</label>
        <div className="rv-helpful-row">
          <button type="button" className="rv-btn rv-helpful-step"
            onClick={() => set('helpful_count', Math.max(0, (parseInt(form.helpful_count, 10) || 0) - 1))}>−</button>
          <input className="rv-input rv-helpful-input" type="number" min="0" value={form.helpful_count}
            onChange={(e) => set('helpful_count', Math.max(0, parseInt(e.target.value, 10) || 0))} />
          <button type="button" className="rv-btn rv-helpful-step"
            onClick={() => set('helpful_count', (parseInt(form.helpful_count, 10) || 0) + 1)}>+</button>
          <button type="button" className="rv-btn rv-helpful-zero"
            onClick={() => set('helpful_count', 0)}>Zero</button>
        </div>

        <label className="rv-field-label">Photos ({form.photo_urls.length}/{MAX_PHOTOS})</label>
        {form.photo_urls.length > 0 && (
          <div className="rv-gallery">
            {form.photo_urls.map((url) => (
              <div key={url} className="rv-gallery-item">
                <img src={url} alt="Review photo" />
                <button type="button" className="rv-gallery-remove" aria-label="Remove photo"
                  onClick={() => removePhoto(url)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className="rv-photo-controls">
          <button type="button" className="rv-btn rv-photo-btn"
            disabled={uploading || form.photo_urls.length >= MAX_PHOTOS}
            onClick={() => fileRef.current?.click()}>
            {uploading ? 'Uploading…' : form.photo_urls.length >= MAX_PHOTOS ? 'Max reached' : 'Add photo'}
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={handlePhoto} />
        </div>
      </div>

      <div className="rv-detail-actions">
        <button className="rv-btn rv-btn--save" disabled={!canSave || saving}
          onClick={handleSave}>{saving ? 'Saving…' : 'Save'}</button>
        {!isNew && (
          <>
            <button className="rv-btn rv-btn--approve" onClick={onApprove}>Approve</button>
            <button className="rv-btn rv-btn--reject" onClick={onReject}>Reject</button>
            <button className="rv-btn rv-btn--delete" onClick={onDelete}>Delete</button>
          </>
        )}
      </div>
    </div>
  );
}

export { EMPTY };
