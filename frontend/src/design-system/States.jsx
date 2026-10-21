import React from 'react';

/**
 * LDS v1.0 LoadingState Component
 * Accessible inline loading indicator.
 */
export function LoadingState({ label = 'Loading…', className = '' }) {
  return (
    <div className={`state ${className}`.trim()} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/**
 * LDS v1.0 ErrorState Component
 * Accessible error alert with retry action.
 */
export function ErrorState({ error, onRetry, className = '' }) {
  const isForbidden = error?.status === 403;
  const isNetwork = error?.status === 0 || error?.message?.toLowerCase().includes('network');

  const title = isForbidden
    ? 'You do not have access to this'
    : isNetwork
    ? 'Network connection issue'
    : 'Could not load this view';

  return (
    <div className={`state state--error ${className}`.trim()} role="alert">
      <strong>{title}</strong>
      <span className="muted">
        {error?.message ?? 'Unexpected error'}
        {error?.requestId ? ` (ref ${error.requestId.slice(0, 8)})` : ''}
      </span>
      {onRetry && !isForbidden && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * LDS v1.0 EmptyState Component
 * High visual polish empty state with icon/illustration, title, hint, and primary CTA.
 */
export function EmptyState({
  icon,
  title = 'No records found',
  hint,
  action,
  className = '',
}) {
  return (
    <div className={`state lds-empty-state ${className}`.trim()}>
      {icon && <div className="lds-empty-state__icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
      {action && <div className="lds-empty-state__action" style={{ marginTop: '0.75rem' }}>{action}</div>}
    </div>
  );
}

/**
 * LDS v1.0 ErrorPage Component
 * Full-page error states for 403, 404, 429, 500, Offline, Session Expired.
 */
export function ErrorPage({
  code = 500, // 403 | 404 | 429 | 500 | 'offline' | 'session-expired'
  title,
  message,
  onAction,
  actionLabel = 'Go back to Dashboard',
}) {
  const defaults = {
    403: {
      code: '403',
      title: 'Access Restricted',
      message: 'You do not have the required permissions or role to view this resource.',
    },
    404: {
      code: '404',
      title: 'Page Not Found',
      message: 'The requested resource or page could not be located on LauncherDesk.',
    },
    429: {
      code: '429',
      title: 'Too Many Requests',
      message: 'Rate limit exceeded. Please wait a moment before trying again.',
    },
    500: {
      code: '500',
      title: 'System Error',
      message: 'An unexpected internal error occurred. Our engineers have been alerted.',
    },
    offline: {
      code: 'OFFLINE',
      title: 'Connection Lost',
      message: 'You appear to be offline. Please check your internet connection.',
    },
    'session-expired': {
      code: 'AUTH',
      title: 'Session Expired',
      message: 'Your authenticated session has ended. Please sign in again to continue.',
    },
  };

  const current = defaults[code] ?? defaults[500];
  const displayTitle = title || current.title;
  const displayMessage = message || current.message;

  return (
    <div className="lds-error-page">
      <div className="card lds-card" style={{ maxWidth: 480, textAlign: 'center', margin: '3rem auto', padding: '2.5rem' }}>
        <div style={{ fontSize: 44, fontWeight: 800, color: 'var(--ink-subtle)', marginBottom: '0.5rem' }}>
          {current.code}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--ink-primary)' }}>
          {displayTitle}
        </h2>
        <p className="muted" style={{ margin: '0 0 1.5rem 0', fontSize: 14 }}>
          {displayMessage}
        </p>
        <div>
          {onAction ? (
            <button type="button" className="btn btn--primary" onClick={onAction}>
              {actionLabel}
            </button>
          ) : (
            <a href="/" className="btn btn--primary">
              {actionLabel}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default {
  LoadingState,
  ErrorState,
  EmptyState,
  ErrorPage,
};
