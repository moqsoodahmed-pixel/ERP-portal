import React from 'react';
import { formatDate } from '../utils/format.js';

/**
 * LDS v1.0 Timeline Component
 */
export function Timeline({ children, className = '' }) {
  return <div className={`lds-timeline ${className}`.trim()}>{children}</div>;
}

export function TimelineItem({
  title,
  timestamp,
  children,
  tone = 'primary', // 'primary' | 'ok' | 'warn' | 'bad'
  className = '',
}) {
  const dotColor = tone === 'ok' ? 'var(--ok)'
    : tone === 'warn' ? 'var(--warn)'
    : tone === 'bad' ? 'var(--bad)'
    : 'var(--primary)';

  return (
    <div className={`lds-timeline-item ${className}`.trim()}>
      <span className="lds-timeline-dot" style={{ borderColor: dotColor }} aria-hidden="true" />
      <div className="lds-timeline-title">{title}</div>
      {timestamp && <div className="lds-timeline-meta">{formatDate(timestamp)}</div>}
      {children && <div style={{ marginTop: '0.35rem', fontSize: '13.5px' }}>{children}</div>}
    </div>
  );
}

/**
 * LDS v1.0 ActivityFeed Component
 */
export function ActivityFeed({ items = [], className = '' }) {
  return (
    <div className={`lds-activity-feed ${className}`.trim()} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {items.map((it, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.75rem',
            padding: '0.75rem',
            background: 'var(--bg-app)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--line-subtle)',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: 'var(--primary-subtle)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {it.user?.[0]?.toUpperCase() || '•'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', color: 'var(--ink-primary)' }}>
              <strong>{it.user || 'System'}</strong> {it.action}
            </div>
            {it.details && <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>{it.details}</div>}
            <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>
              {it.timestamp ? formatDate(it.timestamp) : 'Just now'}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default {
  Timeline,
  TimelineItem,
  ActivityFeed,
};
