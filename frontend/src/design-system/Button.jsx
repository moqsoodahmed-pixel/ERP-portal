import React from 'react';

/**
 * LDS v1.0 Button Component
 * High-performance, accessible enterprise button supporting variants, sizes, and states.
 */
export function Button({
  children,
  variant = 'secondary', // 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost' | 'link'
  size = 'md', // 'sm' | 'md' | 'lg'
  disabled = false,
  loading = false,
  startIcon,
  endIcon,
  fullWidth = false,
  className = '',
  type = 'button',
  as: Component = 'button',
  ...props
}) {
  const variantClass = variant === 'primary' ? 'btn--primary'
    : variant === 'danger' ? 'btn--danger'
    : variant === 'ghost' ? 'btn--ghost'
    : variant === 'link' ? 'btn--link'
    : variant === 'outline' ? 'btn--outline'
    : '';

  const sizeClass = size === 'sm' ? 'btn--sm'
    : size === 'lg' ? 'btn--lg'
    : '';

  const fullWidthClass = fullWidth ? 'w-full' : '';

  return (
    <Component
      type={Component === 'button' ? type : undefined}
      className={`btn ${variantClass} ${sizeClass} ${fullWidthClass} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      {...props}
    >
      {loading && <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14, marginRight: 6 }} />}
      {!loading && startIcon && <span className="btn__icon btn__icon--start">{startIcon}</span>}
      <span className="btn__text">{children}</span>
      {!loading && endIcon && <span className="btn__icon btn__icon--end">{endIcon}</span>}
    </Component>
  );
}

/**
 * LDS v1.0 IconButton Component
 * Accessible circular/square icon-only action button.
 */
export function IconButton({
  icon,
  label,
  title,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  loading = false,
  className = '',
  type = 'button',
  ...props
}) {
  const tooltipText = title || label;
  return (
    <button
      type={type}
      className={`btn-icon btn-icon--${variant} btn-icon--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-label={label || title}
      title={tooltipText}
      {...props}
    >
      {loading ? <span className="spinner" aria-hidden="true" style={{ width: 14, height: 14 }} /> : icon}
    </button>
  );
}

export default {
  Button,
  IconButton,
};
