import { useState } from 'react';

const EMPTY = { author: '', rating: 5, title: '', body: '', review_date: '', photo_url: '', verified: false };

// Right-side detail panel — edit an existing review or fill in a new manual one.
// Photo is preview-only in F1 (upload arrives in F4); the verified toggle persists now.
export default function ReviewDetail({ review, isNew, saving, onSave, onApprove, onReject, onDelete, onClose }) {
  const [form, setForm] = useState(() => ({
    author: review?.author || '',
    rating: review?.rating || 5,
    title: review?.title || '',
    body: review?.body || '',
    review_date: review?.review_date || new Date().toISOString().slice(0, 10),
    photo_url: review?.photo_url || '',
    verified: !!review?.verified,
  }));

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const canSave = form.author.trim() && form.body.trim();

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

        <label className="rv-field-label">Photo</label>
        {form.photo_url ? (
          <div className="rv-photo-preview">
            <img src={form.photo_url} alt="Review" />
          </div>
        ) : (
          <div className="rv-photo-empty">No photo — upload arrives in a later phase</div>
        )}
      </div>

      <div className="rv-detail-actions">
        <button className="rv-btn rv-btn--save" disabled={!canSave || saving}
          onClick={() => onSave(form)}>{saving ? 'Saving…' : 'Save'}</button>
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
