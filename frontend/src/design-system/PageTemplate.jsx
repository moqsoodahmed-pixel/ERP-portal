import React from 'react';

/**
 * LDS v1.0 PageHeader Component
 */
export function PageHeader({ title, subtitle, breadcrumbs, actions, className = '' }) {
  return (
    <header className={`page-header ${className}`.trim()}>
      <div>
        {breadcrumbs && <div style={{ marginBottom: '0.35rem' }}>{breadcrumbs}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

/**
 * LDS v1.0 PageToolbar Component
 */
export function PageToolbar({ children, search, filters, actions, className = '' }) {
  return (
    <div className={`toolbar ${className}`.trim()}>
      {search && <div className="toolbar__search" style={{ flex: 1, maxWidth: 360 }}>{search}</div>}
      {filters && <div className="toolbar__filters" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{filters}</div>}
      {actions && <div className="toolbar__actions" style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>{actions}</div>}
      {children}
    </div>
  );
}

/**
 * LDS v1.0 PageFilterGroup Component
 */
export function PageFilterGroup({ children, className = '' }) {
  return (
    <div className={`page-filter-group ${className}`.trim()} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
      {children}
    </div>
  );
}

/**
 * LDS v1.0 PageTemplate Component
 * Standard enterprise layout: Header -> Toolbar -> Content -> Footer.
 */
export function PageTemplate({
  title,
  subtitle,
  breadcrumbs,
  actions,
  toolbar,
  children,
  footer,
  className = '',
}) {
  return (
    <div className={`lds-page ${className}`.trim()}>
      {(title || actions) && (
        <PageHeader
          title={title}
          subtitle={subtitle}
          breadcrumbs={breadcrumbs}
          actions={actions}
        />
      )}
      {toolbar && <div style={{ marginBottom: '1.25rem' }}>{toolbar}</div>}
      <main className="lds-page__content">{children}</main>
      {footer && (
        <footer className="lds-page__footer" style={{ marginTop: '2.5rem', paddingTop: '1rem', borderTop: '1px solid var(--line-default)', textAlign: 'center', fontSize: '12px', color: 'var(--ink-muted)' }}>
          {footer}
        </footer>
      )}
    </div>
  );
}

export default {
  PageHeader,
  PageToolbar,
  PageFilterGroup,
  PageTemplate,
};
