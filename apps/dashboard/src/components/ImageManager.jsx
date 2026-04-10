import { useState } from 'react';
import './ImageManager.css';

const VISIBLE_COUNT = 8;

export default function ImageManager({ images, editing, onChange }) {
  const [expanded, setExpanded] = useState(false);

  const handleDelete = (idx) => {
    onChange(images.filter((_, i) => i !== idx));
  };

  const handleMoveUp = (idx) => {
    if (idx === 0) return;
    const next = [...images];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };

  const allImages = images || [];
  const showImages = expanded ? allImages : allImages.slice(0, VISIBLE_COUNT);
  const hiddenCount = allImages.length - VISIBLE_COUNT;

  return (
    <div className="imgm-wrap">
      <div className="imgm-grid">
        {showImages.map((img, i) => {
          const src = typeof img === 'string' ? img : img.src;
          return (
            <div key={img.id || i} className="imgm-item">
              <img src={src} alt="" className="imgm-thumb" loading="lazy" />
              {editing && (
                <div className="imgm-actions">
                  {i > 0 && <button className="imgm-action" onClick={() => handleMoveUp(i)} title="Move left">&larr;</button>}
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
    </div>
  );
}
