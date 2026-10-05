export function LoadingState({ label = 'Loading…' }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <strong>{error?.status === 403 ? 'You do not have access to this' : 'Could not load this view'}</strong>
      <span className="muted">{error?.message ?? 'Unexpected error'}{error?.requestId ? ` (ref ${error.requestId.slice(0, 8)})` : ''}</span>
      {onRetry && error?.status !== 403 && <button type="button" className="btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function EmptyState({ title, hint }) {
  return (
    <div className="state">
      <strong>{title}</strong>
      {hint && <span className="muted">{hint}</span>}
    </div>
  );
}
