import React, { useState, useEffect } from 'react';

/**
 * LDS v1.0 Breadcrumb Component
 */
export function Breadcrumb({ items = [], className = '' }) {
  if (items.length === 0) return null;
  return (
    <nav className={`lds-breadcrumb ${className}`.trim()} aria-label="Breadcrumb">
      <ol style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', listStyle: 'none', padding: 0, margin: 0, fontSize: '13px' }}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {isLast ? (
                <span style={{ fontWeight: 600, color: 'var(--ink-primary)' }} aria-current="page">
                  {item.label}
                </span>
              ) : item.href ? (
                <a href={item.href} style={{ color: 'var(--ink-muted)', textDecoration: 'none' }}>
                  {item.label}
                </a>
              ) : (
                <span style={{ color: 'var(--ink-muted)' }}>{item.label}</span>
              )}
              {!isLast && <span style={{ color: 'var(--ink-subtle)', userSelect: 'none' }}>/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * LDS v1.0 Tabs Component
 */
export function Tabs({ tabs = [], activeTab, onChange, className = '' }) {
  return (
    <div className={`lds-tabs ${className}`.trim()}>
      <div className="lds-tab-list" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`lds-tab-trigger ${isActive ? 'is-active' : ''}`}
              onClick={() => onChange(tab.key)}
            >
              {tab.icon && <span aria-hidden="true">{tab.icon}</span>}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className={`badge ${isActive ? 'badge--ok' : 'badge--neutral'}`}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * LDS v1.0 QuickActionPanel Component
 */
export function QuickActionPanel({ actions = [], className = '' }) {
  return (
    <div className={`lds-quick-panel ${className}`.trim()}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem' }}>
        {actions.map((act, idx) => (
          <button
            key={idx}
            type="button"
            className="card lds-card"
            onClick={act.onClick}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '1rem',
              cursor: 'pointer',
              border: '1px solid var(--line-default)',
              background: 'var(--bg-card)',
              gap: '0.5rem',
              textAlign: 'center',
            }}
          >
            {act.icon && <div style={{ fontSize: '20px', color: 'var(--primary)' }}>{act.icon}</div>}
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink-primary)' }}>{act.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * LDS v1.0 CommandPalette Component
 */
export function CommandPalette({ open, onClose, commands = [] }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = commands.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase()) ||
    c.category?.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filtered.length));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filtered.length) % Math.max(1, filtered.length));
      }
      if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].onSelect?.();
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose, filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div className="lds-palette-backdrop" onClick={onClose}>
      <div className="lds-palette" onClick={(e) => e.stopPropagation()}>
        <div className="lds-palette-input-wrap">
          <span style={{ color: 'var(--ink-muted)' }}>🔍</span>
          <input
            type="search"
            autoFocus
            placeholder="Type a command or search modules…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="lds-palette-input"
          />
        </div>
        <ul className="lds-palette-list">
          {filtered.length === 0 ? (
            <li style={{ padding: '1rem', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 13 }}>
              No commands found for &quot;{query}&quot;
            </li>
          ) : (
            filtered.map((cmd, idx) => (
              <li
                key={idx}
                className={`lds-palette-item ${idx === selectedIndex ? 'is-active' : ''}`}
                onClick={() => {
                  cmd.onSelect?.();
                  onClose?.();
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                {cmd.icon && <span>{cmd.icon}</span>}
                <span style={{ flex: 1 }}>{cmd.title}</span>
                {cmd.category && <span className="muted" style={{ fontSize: 11 }}>{cmd.category}</span>}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

export default {
  Breadcrumb,
  Tabs,
  QuickActionPanel,
  CommandPalette,
};
