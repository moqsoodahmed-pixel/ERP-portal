import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }) {
  const confirmRef = useRef(null);
  useEffect(() => { if (open) confirmRef.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="overlay">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-msg">
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-msg" className="muted">{message}</p>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" ref={confirmRef} className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
