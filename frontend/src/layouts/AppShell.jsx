import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { canAny } from '../permissions/permissions.js';
import { ROLE_LABEL } from '../constants/roles.js';
import NotificationBell from '../components/NotificationBell.jsx';

export default function AppShell({ nav, brandNote }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const items = nav.items.filter((i) => canAny(user, i.permission ? [i.permission] : []));

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Primary">
        <div className="brand"><span className="brand__mark" aria-hidden="true" />ERP Platform<small>{brandNote}</small></div>
        <p className="nav-title">{nav.title}</p>
        <nav>
          <ul className="nav">
            {items.map((i) => (
              <li key={i.to}><NavLink to={i.to} onClick={() => setOpen(false)} className={({ isActive }) => `nav__link ${isActive ? 'is-active' : ''}`}>{i.label}</NavLink></li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="main">
        <div className="topbar">
          <button type="button" className="btn topbar__menu" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen((v) => !v)}>Menu</button>
          <div className="topbar__user">
            <NotificationBell />
            <span><strong>{user?.name}</strong><small className="muted"> · {ROLE_LABEL[user?.role]}</small></span>
            <button type="button" className="btn" onClick={logout}>Sign out</button>
          </div>
        </div>
        <main className="content" id="content"><Outlet /></main>
      </div>
    </div>
  );
}
