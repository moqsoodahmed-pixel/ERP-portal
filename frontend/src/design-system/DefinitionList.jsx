import React from 'react';

/**
 * LDS v1.0 DefinitionList Component
 * Two-column or responsive multi-column key-value enterprise metadata presentation.
 */
export function DefinitionList({ children, columns, className = '', style = {} }) {
  const inlineStyle = columns
    ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, ...style }
    : style;

  return (
    <dl className={`definition-list ${className}`.trim()} style={inlineStyle}>
      {children}
    </dl>
  );
}

/**
 * LDS v1.0 DefinitionItem Component
 */
export function DefinitionItem({
  label,
  value,
  mono = false,
  badge,
  children,
  className = '',
}) {
  const content = children !== undefined ? children : (value ?? '—');

  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>
        {badge ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            {content}
            {badge}
          </span>
        ) : (
          content
        )}
      </dd>
    </div>
  );
}

export default {
  DefinitionList,
  DefinitionItem,
};
