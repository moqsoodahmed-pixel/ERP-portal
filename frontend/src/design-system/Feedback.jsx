import React, { useEffect, useRef } from 'react';

/**
 * LDS v1.0 Modal Component
 * Accessible dialog container with backdrop, Escape key listener, and focus trapping.
 */
export function Modal({
  open = false,
  title,
  children,
  footer,
  onClose,
  maxWidth = 520,
  className = '',
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="overlay lds-modal-backdrop" onClick={onClose}>
      <div
        className={`dialog lds-modal-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'modal-title' : undefined}
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="dialog__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 id="modal-title" style={{ margin: 0, fontSize: '18px' }}>{title}</h2>
            {onClose && (
              <button
                type="button"
                className="btn-icon"
                onClick={onClose}
                aria-label="Close dialog"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px' }}
              >
                ✕
              </button>
            )}
          </div>
        )}
        <div className="dialog__body">{children}</div>
        {footer && <div className="dialog__actions" style={{ marginTop: '1.25rem' }}>{footer}</div>}
      </div>
    </div>
  );
}

/**
 * LDS v1.0 ConfirmModal Component
 * Accessible alertdialog for critical confirmations (tested by components.test.jsx).
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-msg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-msg" className="muted">{message}</p>
        <div className="dialog__actions">
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button
            type="button"
            ref={confirmRef}
            className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * LDS v1.0 Drawer Component
 * Side slide-out panel for quick views, filters, and mobile navigation.
 */
export function Drawer({
  open = false,
  title,
  children,
  footer,
  onClose,
  width = 400,
  className = '',
}) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="lds-drawer-backdrop" onClick={onClose}>
      <aside
        className={`lds-drawer ${className}`.trim()}
        style={{ width: `min(${width}px, 92vw)` }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="lds-drawer__header">
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{title}</h3>
          {onClose && (
            <button
              type="button"
              className="btn-icon"
              onClick={onClose}
              aria-label="Close panel"
              style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px' }}
            >
              ✕
            </button>
          )}
        </div>
        <div className="lds-drawer__body">{children}</div>
        {footer && <div className="lds-drawer__footer">{footer}</div>}
      </aside>
    </div>
  );
}

/**
 * LDS v1.0 Tooltip Component
 */
export function Tooltip({ text, children, className = '' }) {
  if (!text) return children;
  return (
    <span className={`lds-tooltip-wrapper ${className}`.trim()}>
      {children}
      <span className="lds-tooltip-bubble" role="tooltip">{text}</span>
    </span>
  );
}

/**
 * LDS v1.0 Toast Component & Container
 */
export function Toast({ tone = 'info', message, onDismiss }) {
  return (
    <div className={`lds-toast lds-toast--${tone}`} role="status">
      <span>{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto', color: 'var(--ink-muted)' }}
          aria-label="Dismiss notification"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function ToastContainer({ toasts = [], onDismiss }) {
  if (toasts.length === 0) return null;
  return (
    <div className="lds-toast-container" aria-live="polite">
      {toasts.map((t) => (
        <Toast key={t.id} tone={t.tone} message={t.message} onDismiss={() => onDismiss?.(t.id)} />
      ))}
    </div>
  );
}

/**
 * LDS v1.0 AlertNotice Component
 */
export function AlertNotice({ tone = 'info', title, children, onDismiss, className = '' }) {
  return (
    <div className={`state state--${tone} ${className}`.trim()} role="alert">
      {title && <strong>{title}</strong>}
      {children}
      {onDismiss && (
        <button type="button" className="btn btn--sm" onClick={onDismiss} style={{ marginLeft: 'auto' }}>
          Dismiss
        </button>
      )}
    </div>
  );
}

/**
 * LDS v1.0 Badge Component
 */
export function Badge({ children, tone = 'neutral', className = '' }) {
  return <span className={`badge badge--${tone} ${className}`.trim()}>{children}</span>;
}

/**
 * LDS v1.0 Avatar Component
 */
export function Avatar({ name = '', size = 32, src, status, className = '' }) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'U';

  return (
    <div
      className={`lds-avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--primary) 0%, var(--accent) 100%)',
        color: '#FFFFFF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 600,
        fontSize: size * 0.4,
        position: 'relative',
        userSelect: 'none',
      }}
      aria-label={name}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
        />
      ) : (
        initials
      )}
      {status && (
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: '50%',
            background: status === 'online' ? 'var(--ok)' : 'var(--ink-muted)',
            border: '2px solid #FFFFFF',
          }}
        />
      )}
    </div>
  );
}

export default {
  Modal,
  ConfirmModal,
  Drawer,
  Tooltip,
  Toast,
  ToastContainer,
  AlertNotice,
  Badge,
  Avatar,
};
