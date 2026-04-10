import { useState } from 'react';
import './TagInput.css';

export default function TagInput({ tags, onChange, disabled }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
    setInput('');
  };

  const removeTag = (idx) => {
    onChange(tags.filter((_, i) => i !== idx));
  };

  return (
    <div className="ti-wrap">
      <div className="ti-tags">
        {tags.map((t, i) => (
          <span key={i} className="ti-tag">
            {t}
            {!disabled && <button className="ti-tag-x" onClick={() => removeTag(i)}>x</button>}
          </span>
        ))}
      </div>
      {!disabled && (
        <div className="ti-input-row">
          <input
            className="ti-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
            placeholder="Add tag..."
          />
          <button className="ti-add" onClick={addTag} disabled={!input.trim()}>+</button>
        </div>
      )}
    </div>
  );
}
