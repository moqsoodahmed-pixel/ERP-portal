import React from 'react';

/**
 * LDS v1.0 Card Component
 * Standard 20px radius enterprise surface container.
 */
export function Card({
  children,
  elevation = 1,
  noPadding = false,
  interactive = false,
  className = '',
  as: Component = 'section',
  ...props
}) {
  const elevClass = `elevation-${elevation}`;
  const padClass = noPadding ? 'p-0' : '';
  const interClass = interactive ? 'card--interactive' : '';

  return (
    <Component
      className={`card lds-card ${elevClass} ${padClass} ${interClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </Component>
  );
}

export function CardHeader({ children, className = '', actions, title, subtitle, ...props }) {
  if (title || subtitle || actions) {
    return (
      <div className={`lds-card__header ${className}`.trim()} {...props}>
        <div>
          {title && <h3 className="lds-card__title">{title}</h3>}
          {subtitle && <p className="lds-card__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="lds-card__actions">{actions}</div>}
        {children}
      </div>
    );
  }
  return (
    <div className={`lds-card__header ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = '', as: Component = 'h3', ...props }) {
  return (
    <Component className={`lds-card__title ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}

export function CardDescription({ children, className = '', ...props }) {
  return (
    <p className={`lds-card__subtitle ${className}`.trim()} {...props}>
      {children}
    </p>
  );
}

export function CardBody({ children, className = '', ...props }) {
  return (
    <div className={`lds-card__body ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ children, className = '', ...props }) {
  return (
    <div className={`lds-card__footer ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

/**
 * LDS v1.0 StatCard Component
 * Enterprise KPI stat card matching Fortune 500 standards with 20px radius, semantic tone, sparkline, and trend.
 * NOTE: For test backward-compatibility, label's immediate previous sibling is <span className="stat__value">.
 */
export function StatCard({
  label,
  value,
  subvalue,
  tone, // 'revenue' | 'invoices' | 'customers' | 'gst' | 'warning' | 'error' | 'pending' | 'success' | 'cancelled'
  icon,
  trend,
  trendDirection, // 'up' | 'down' | 'neutral'
  sparklineTone,
  chevron = false,
  className = '',
  onClick,
  ...props
}) {
  const toneClass = tone ? `stat--tone-${tone}` : '';
  const isInteractive = Boolean(onClick);

  return (
    <div
      className={`stat ${toneClass} ${isInteractive ? 'stat--interactive' : ''} ${className}`.trim()}
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      {...props}
    >
      <div className="stat__top">
        {icon && (
          <div className="stat__icon-box" aria-hidden="true">
            {icon}
          </div>
        )}
        <div className="stat__metrics">
          <span className="stat__value">{value}</span>
          <span className="stat__label">{label}</span>
          {subvalue && <span className="stat__subvalue">{subvalue}</span>}
        </div>
      </div>

      {trend && (
        <div className="stat__bottom">
          {sparklineTone && (
            <svg className="stat__sparkline" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M0 20 Q 25 15, 50 18 T 100 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
          <span className={`stat__trend stat__trend--${trendDirection ?? 'neutral'}`}>
            {trendDirection === 'up' && '↑ '}
            {trendDirection === 'down' && '↓ '}
            {trendDirection === 'neutral' && '— '}
            {trend}
          </span>
        </div>
      )}

      {chevron && (
        <span className="stat__chevron" aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}

/**
 * LDS v1.0 AnalyticsCard Component
 * Metric summary card with top header, primary figure, secondary breakdown, and slot for chart/visual.
 */
export function AnalyticsCard({
  title,
  subtitle,
  metric,
  change,
  changeDirection = 'up',
  children,
  actions,
  className = '',
  ...props
}) {
  return (
    <Card className={`analytics-card ${className}`.trim()} {...props}>
      <CardHeader title={title} subtitle={subtitle} actions={actions} />
      <CardBody>
        {metric && (
          <div className="analytics-card__headline">
            <span className="analytics-card__metric">{metric}</span>
            {change && (
              <span className={`badge badge--${changeDirection === 'up' ? 'ok' : 'bad'}`}>
                {changeDirection === 'up' ? '↑' : '↓'} {change}
              </span>
            )}
          </div>
        )}
        {children}
      </CardBody>
    </Card>
  );
}

export default {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardBody,
  CardFooter,
  StatCard,
  AnalyticsCard,
};
