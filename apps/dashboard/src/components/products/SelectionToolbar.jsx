import { useState, useRef, useEffect } from 'react';
import './SelectionToolbar.css';

export default function SelectionToolbar({
  selectedCount, onMakeUnlisted, onMakeListed, onExportCsv, onClear,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  if (selectedCount === 0) return null;

  return (
    <div className="selection-toolbar" role="toolbar" aria-label="Bulk actions">
      <div className="selection-toolbar__count">{selectedCount} selected</div>
      <div className="selection-toolbar__actions" ref={menuRef}>
        <button
          type="button"
          className="selection-toolbar__btn selection-toolbar__btn--primary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          Bulk actions ▾
        </button>
        {open && (
          <div className="selection-toolbar__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMakeUnlisted(); }}>
              Make Unlisted
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onMakeListed(); }}>
              Make Listed
            </button>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); onExportCsv(); }}>
              Export selected as CSV
            </button>
          </div>
        )}
        <button
          type="button"
          className="selection-toolbar__btn"
          onClick={onClear}
        >
          Clear selection
        </button>
      </div>
    </div>
  );
}
