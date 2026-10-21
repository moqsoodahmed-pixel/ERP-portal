/**
 * LauncherDesk's actual registered logo artwork — mark shapes, wordmark letterforms, and all original
 * colors are reproduced exactly as supplied (a trademark is never redrawn or recolored).
 * Public brand assets:
 *   - /brand/launcherdesk-full.png      — full lockup: mark + wordmark + tagline + arrow
 *   - /brand/launcherdesk-mark.png      — hexagon mark alone
 *   - /brand/launcherdesk-wordmark.png  — "LauncherDesk (TM)" wordmark alone
 */
const FULL_SRC = '/brand/launcherdesk-full.png';

/**
 * Sidebar Brand Lockup: Pristine white rounded card containing the authentic LauncherDesk
 * full logo, exactly as required by enterprise design guidelines and reference layout.
 */
export function BrandSidebar({ subtitle }) {
  return (
    <div className="ld-sidebar-brand-wrapper">
      <div className="ld-sidebar-brand-card">
        <img
          src={FULL_SRC}
          alt="LauncherDesk — Startups Made Easy"
          className="ld-sidebar-logo"
        />
      </div>
      {subtitle && <span className="ld-sidebar-brand-subtitle">{subtitle}</span>}
    </div>
  );
}

/**
 * Backward-compatible compact brand component for sidebar / topbar.
 */
export function BrandCompact({ subtitle }) {
  return <BrandSidebar subtitle={subtitle} />;
}

/**
 * Full authentic lockup for larger surfaces, e.g. the login page.
 */
export function BrandFull({ width = 260 }) {
  return (
    <div className="ld-brand ld-brand--full">
      <div className="ld-brand-card-white">
        <img
          src={FULL_SRC}
          alt="LauncherDesk — Startups Made Easy"
          style={{ width: `${width}px`, maxWidth: '100%', height: 'auto', display: 'block' }}
        />
      </div>
    </div>
  );
}
