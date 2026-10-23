import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/apiClient.js';
import { useAuth } from '../context/AuthContext.jsx';
import { can } from '../permissions/permissions.js';
import { formatDateTime } from '../utils/format.js';

export const POLL_MS = 30_000;
const SEVERITY_TONE = { INFO: 'info', WARNING: 'warn', CRITICAL: 'bad' };

/**
 * Click-through policy: a notification's actionUrl is rendered as a link ONLY when it points into the
 * current user's own area AND the user holds the permission the target route is guarded by. Otherwise the
 * text is shown without a link (we never render a link that would land on "Access restricted"). The backend
 * still enforces access on every API call the target page makes.
 */
const ROUTE_PERMISSIONS = [
  [/^\/client\/invoices\//, 'invoices.view'],
  [/^\/client\/gst-filings\//, 'gst_filings.view'],
  [/^\/client\/gst-vendor$/, 'business.view'],
  [/^\/client\/dashboard$/, 'dashboard.view'],
  [/^\/vendor\/filings\//, 'gst_filings.view'],
  [/^\/vendor\/clients$/, 'gst.view'],
];
const AREA = {
  MASTER_ADMIN: '/master/',
  MASTER_ASSISTANT_ADMIN: '/master/',
  CLIENT_ADMIN: '/client/',
  CLIENT_USER: '/client/',
  GST_VENDOR: '/vendor/',
};

export function linkFor(user, actionUrl) {
  if (!actionUrl || !user || !actionUrl.startsWith(AREA[user.role] ?? '\u0000')) return null;
  const rule = ROUTE_PERMISSIONS.find(([rx]) => rx.test(actionUrl));
  return rule && can(user, rule[1]) ? actionUrl : null;
}

/** Header bell: unread badge (polled every 30s, no WebSockets), dropdown of recent items, mark read / mark all. */
export default function NotificationBell() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState({ status: 'idle', items: [], error: null });
  const wrap = useRef(null);

  const refreshCount = useCallback(() => {
    api.get('/notifications/unread-count').then((r) => setUnread(r.data.unread)).catch(() => {});
  }, []);

  const loadList = useCallback(() => {
    setList((s) => ({ ...s, status: 'loading', error: null }));
    api.get('/notifications?limit=10')
      .then((r) => setList({ status: 'ready', items: r.data.items, error: null }))
      .catch((error) => setList({ status: 'error', items: [], error }));
  }, []);

  useEffect(() => {
    refreshCount();
    const id = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(id);
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onClick = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const toggle = () => { const next = !open; setOpen(next); if (next) loadList(); };

  const markRead = async (n) => {
    if (n.isRead) return;
    try {
      const { data } = await api.patch(`/notifications/${n._id}/read`);
      setList((s) => ({ ...s, items: s.items.map((x) => (x._id === n._id ? data : x)) }));
      setUnread((u) => Math.max(0, u - 1));
    } catch { /* leave as unread; next poll reconciles */ }
  };

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all');
      setList((s) => ({ ...s, items: s.items.map((x) => ({ ...x, isRead: true })) }));
      setUnread(0);
    } catch { /* next poll reconciles */ }
  };

  return (
    <div className="bell" ref={wrap}>
      <button type="button" className="bell__button" aria-haspopup="true" aria-expanded={open} onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <span className="sr-only">Notifications</span>
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="bell__badge" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__panel" role="region" aria-label="Recent notifications">
          <div className="bell__head">
            <strong>Notifications</strong>
            <button type="button" className="btn btn--small" onClick={markAll} disabled={unread === 0}>Mark all read</button>
          </div>
          {list.status === 'loading' && <p className="muted bell__state" role="status">Loading…</p>}
          {list.status === 'error' && <p className="bell__state state--error" role="alert">Could not load notifications.</p>}
          {list.status === 'ready' && list.items.length === 0 && <p className="muted bell__state">You have no notifications yet.</p>}
          {list.status === 'ready' && list.items.length > 0 && (
            <ul className="bell__list">
              {list.items.map((n) => {
                const href = linkFor(user, n.actionUrl);
                return (
                  <li key={n._id} className={`bell__item ${n.isRead ? '' : 'is-unread'}`}>
                    <span className={`badge badge--${SEVERITY_TONE[n.severity] ?? 'neutral'}`}>{n.severity.toLowerCase()}</span>
                    <div className="bell__body">
                      {href
                        ? <Link to={href} onClick={() => { markRead(n); setOpen(false); }}>{n.title}</Link>
                        : <span>{n.title}</span>}
                      {n.message && <small className="muted">{n.message}</small>}
                      <small className="muted"><time dateTime={n.createdAt}>{formatDateTime(n.createdAt)}</time></small>
                    </div>
                    {!n.isRead && <button type="button" className="btn btn--small" onClick={() => markRead(n)} aria-label={`Mark "${n.title}" as read`}>Mark read</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
