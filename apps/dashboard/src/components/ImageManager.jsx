import { useState, useEffect, useCallback } from 'react';
import './ImageManager.css';

const VISIBLE_COUNT = 8;

export default function ImageManager({ images, editing, onChange }) {
  const [expanded, setExpanded] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dropIndex, setDropIndex] = useState(null);
  const [lightbox, setLightbox] = useState(null);

  const allImages = images || [];
  const openLightbox = useCallback((idx) => { setLightbox(idx); }, []);
  const closeLightbox = useCallback(() => setLightbox(null), []);
  const prevImage = useCallback(() => setLightbox((i) => i > 0 ? i - 1 : allImages.length - 1), [allImages.length]);
  const nextImage = useCallback(() => setLightbox((i) => i < allImages.length - 1 ? i + 1 : 0), [allImages.length]);

  useEffect(() => {
    if (lightbox === null) return;
    const handler = (e) => {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightbox, closeLightbox, prevImage, nextImage]);

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
              <div className="imgm-actions">
                <button className="imgm-action" onClick={(e) => { e.stopPropagation(); openLightbox(i); }} title="Zoom">⛶</button>
                {editing && <button className="imgm-action imgm-action--delete" onClick={(e) => { e.stopPropagation(); handleDelete(i); }} title="Remove">x</button>}
              </div>
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

      {lightbox !== null && (() => {
        const lbImg = allImages[lightbox];
        const lbSrc = typeof lbImg === 'string' ? lbImg : lbImg?.src;
        return (
          <div className="imgm-lightbox" onClick={closeLightbox}>
            <button className="imgm-lightbox-close" onClick={closeLightbox}>&times;</button>
            {allImages.length > 1 && (
              <button className="imgm-lightbox-nav imgm-lightbox-nav--prev" onClick={(e) => { e.stopPropagation(); prevImage(); }}>&#8249;</button>
            )}
            <img src={lbSrc} alt="" className="imgm-lightbox-img" onClick={(e) => e.stopPropagation()} />
            {allImages.length > 1 && (
              <button className="imgm-lightbox-nav imgm-lightbox-nav--next" onClick={(e) => { e.stopPropagation(); nextImage(); }}>&#8250;</button>
            )}
            <div className="imgm-lightbox-counter">{lightbox + 1} / {allImages.length}</div>
          </div>
        );
      })()}
    </div>
  );
}
