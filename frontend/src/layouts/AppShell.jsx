import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAny } from '../permissions/permissions.js';
import { ROLE_LABEL } from '../constants/roles.js';
import NotificationBell from '../components/NotificationBell.jsx';
import { BrandSidebar } from '../components/Brand.jsx';
import { IconMenu, IconSignOut, IconUser, IconSearch, getNavIcon } from '../components/Icons.jsx';
import { CommandPalette } from '../design-system/Navigation.jsx';

/** Persisted light/dark preference — applied via a `data-theme` attribute consumed by styles.css. */
function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('ld-theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ld-theme', theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export default function AppShell({ nav, brandNote }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const items = nav.items.filter((i) => canAny(user, i.permission ? [i.permission] : []));

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = items.map((i) => ({
    title: i.label, category: nav.title, icon: getNavIcon(i.to), onSelect: () => navigate(i.to),
  }));

  return (
    <div className="shell">
      {open && <div className="sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Primary">
        <div className="sidebar__brand-area">
          <BrandSidebar subtitle={brandNote} />
        </div>
        <div className="sidebar__nav-section">
          <p className="nav-title">{nav.title || 'WORKSPACE'}</p>
          <nav aria-label="Main Navigation">
            <ul className="nav">
              {items.map((i) => {
                const icon = getNavIcon(i.to);
                const hasSubmenu = i.label.includes('&') || i.label.toLowerCase() === 'reports' || i.label.toLowerCase() === 'sales' || i.label.toLowerCase() === 'purchases';
                return (
                  <li key={i.to} className="nav__item">
                    <NavLink
                      to={i.to}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) => `nav__link ${isActive ? 'is-active' : ''}`}
                    >
                      <span className="nav__icon" aria-hidden="true">{icon}</span>
                      <span className="nav__label">{i.label}</span>
                      {hasSubmenu && (
                        <svg className="nav__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        </div>
        <div className="sidebar__footer">
          <div className="sidebar__help-card" role="button" tabIndex={0} onClick={() => window.open('mailto:support@launcherdesk.com', '_blank')}>
            <div className="sidebar__help-icon" aria-hidden="true">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
              </svg>
            </div>
            <div className="sidebar__help-text">
              <span className="sidebar__help-title">Need Help?</span>
              <span className="sidebar__help-sub">Our support team is here</span>
            </div>
            <span className="sidebar__help-arrow">→</span>
          </div>
        </div>
      </aside>
      <div className="main">
        {/* Continuous Page Background Canvas (Parallax Page Layer) */}
        <div className="dashboard-page-canvas" aria-hidden="true">
          <div className="canvas-layer canvas-layer--base-mesh" />
          <div className="canvas-layer canvas-layer--hero-canvas" />
          <div className="canvas-layer canvas-layer--vector-waves" />
          <div className="canvas-layer canvas-layer--ambient-fade" />
          <div className="canvas-layer canvas-layer--grain" />
        </div>
        <header className="topbar">
          <div className="topbar__left">
            <button
              type="button"
              className="btn topbar__menu"
              aria-expanded={open}
              aria-label="Toggle navigation"
              onClick={() => setOpen((v) => !v)}
            >
              <IconMenu width={16} height={16} />
              <span>Menu</span>
            </button>
            <button type="button" className="topbar__search" onClick={() => setPaletteOpen(true)}>
              <IconSearch width={16} height={16} />
              <span className="placeholder">Search anything... (invoices, customers, products, GST, reports)</span>
              <kbd>Ctrl K</kbd>
            </button>
          </div>
          <div className="topbar__user">
            <NotificationBell />
            <button
              type="button"
              className="topbar__theme-toggle"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={toggleTheme}
            >
              {theme === 'dark' ? (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" /></svg>
              ) : (
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" /></svg>
              )}
            </button>
            <div className="topbar__profile" title={ROLE_LABEL[user?.role]}>
              <span className="topbar__avatar" aria-hidden="true">
                <img
                  src="/brand/admin_avatar.jpg"
                  alt=""
                  className="topbar__avatar-img"
                  onError={(e) => { e.currentTarget.style.display = 'none'; if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'inline-flex'; }}
                />
                <IconUser width={16} height={16} style={{ display: 'none' }} />
              </span>
              <span className="topbar__identity">
                <strong>{user?.name}</strong>
                <small className="muted">{ROLE_LABEL[user?.role]}</small>
              </span>
              <svg className="topbar__profile-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            <button type="button" className="btn btn--signout" onClick={logout} title="Sign out">
              <IconSignOut width={15} height={15} />
              <span>Sign out</span>
            </button>
          </div>
        </header>
        <main className="content" id="content">
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commands} />
    </div>
  );
}
