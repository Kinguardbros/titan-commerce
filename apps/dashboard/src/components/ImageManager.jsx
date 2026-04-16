import { useState } from 'react';
import './ImageManager.css';

const VISIBLE_COUNT = 8;

export default function ImageManager({ images, editing, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);

  const handleDelete = (idx) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  const handleDragStart = (idx) => (e) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (idx) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setDropIndex(idx);
  };

  const handleDrop = (idx) => (e) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) {
      setDragIndex(null); setDropIndex(null); return;
    }
    const next = [...images];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(idx, 0, moved);
    onChange(next);
    setDragIndex(null); setDropIndex(null);
  };

  const handleDragEnd = () => { setDragIndex(null); setDropIndex(null); };

  const allImages = images || [];
  const showImages = expanded ? allImages : allImages.slice(0, VISIBLE_COUNT);
  const hiddenCount = allImages.length - VISIBLE_COUNT;

  return (
    <div className="imgm-wrap">
      <div className="imgm-grid">
        {showImages.map((img, i) => {
          const src = typeof img === 'string' ? img : img.src;
          const cls = `imgm-item${dragIndex === i ? ' imgm-item--dragging' : ''}${dropIndex === i ? ' imgm-item--drop' : ''}`;
          return (
            <div
              key={img.id || i}
              className={cls}
              draggable={editing}
              onDragStart={editing ? handleDragStart(i) : undefined}
              onDragOver={editing ? handleDragOver(i) : undefined}
              onDrop={editing ? handleDrop(i) : undefined}
              onDragEnd={editing ? handleDragEnd : undefined}
            >
              <img src={src} alt="" className="imgm-thumb" loading="lazy" draggable={false} />
              {i === 0 && <span className="imgm-badge">Cover</span>}
              {editing && (
                <div className="imgm-actions">
                  <button className="imgm-action imgm-action--delete" onClick={() => handleDelete(i)} title="Remove">x</button>
                </div>
              )}
            </div>
          );
        })}
        {!expanded && hiddenCount > 0 && (
          <button className="imgm-more" onClick={() => setExpanded(true)}>+{hiddenCount}</button>
        )}
      </div>
      {editing && allImages.length > 1 && (
        <div className="imgm-hint">Drag images to reorder. First image is the cover.</div>
      )}
    </div>
  );
}
