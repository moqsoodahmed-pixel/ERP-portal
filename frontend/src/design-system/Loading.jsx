import React from 'react';

/**
 * LDS v1.0 LoadingSpinner Component
 */
export function LoadingSpinner({ size = 20, className = '' }) {
  return (
    <span
      className={`spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/**
 * LDS v1.0 SkeletonLoader Component
 */
export function SkeletonLoader({
  type = 'text', // 'text' | 'avatar' | 'card' | 'rect'
  width,
  height,
  className = '',
  style = {},
}) {
  const typeClass = type === 'text' ? 'lds-skeleton--text'
    : type === 'avatar' ? 'lds-skeleton--avatar'
    : type === 'card' ? 'lds-skeleton--card'
    : '';

  return (
    <span
      className={`lds-skeleton ${typeClass} ${className}`.trim()}
      style={{
        width,
        height,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

/**
 * LDS v1.0 SkeletonCard Component
 */
export function SkeletonCard({ rows = 3, className = '' }) {
  return (
    <div className={`card lds-card ${className}`.trim()} style={{ padding: '1.5rem' }}>
      <SkeletonLoader width="40%" height={20} style={{ marginBottom: '1rem' }} />
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonLoader key={i} width={`${85 - i * 15}%`} height={14} style={{ marginBottom: '0.5rem' }} />
      ))}
    </div>
  );
}

/**
 * LDS v1.0 ProgressBar Component
 */
export function ProgressBar({
  value = 0,
  max = 100,
  tone, // 'ok' | 'warn' | 'bad'
  showLabel = false,
  className = '',
}) {
  const percent = Math.min(100, Math.max(0, Math.round((value / max) * 100)));
  const toneClass = tone ? `lds-progress-fill--${tone}` : '';

  return (
    <div className={`lds-progress-wrapper ${className}`.trim()} style={{ width: '100%' }}>
      {showLabel && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem', fontSize: '12px' }}>
          <span className="muted">Progress</span>
          <span style={{ fontWeight: 600 }}>{percent}%</span>
        </div>
      )}
      <div className="lds-progress-track">
        <div
          className={`lds-progress-fill ${toneClass}`.trim()}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
        />
      </div>
    </div>
  );
}

export default {
  LoadingSpinner,
  SkeletonLoader,
  SkeletonCard,
  ProgressBar,
};
