import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';

const ts = (s) => {
  const diff = (Date.now() - new Date(s).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
};

const severityClass = (sev) => (sev === 'important' ? 'sev-important' : sev === 'warning' ? 'sev-warning' : 'sev-info');

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);

  const load = () => {
    api
      .get('/notifications')
      .then((d) => {
        setItems(d.notifications || []);
        setUnread(d.unread || 0);
      })
      .catch(() => {});
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 45000);
    return () => clearInterval(t);
  }, []);

  const markAll = async () => {
    await api.post('/notifications/read', { all: true }).catch(() => {});
    setUnread(0);
    setItems((list) => list.map((n) => ({ ...n, is_read: 1 })));
  };

  const openItem = async (n) => {
    if (!n.is_read) {
      await api.post('/notifications/read', { ids: [n.id] }).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, is_read: 1 } : x)));
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  const enableDesktop = async () => {
    if (!('Notification' in window)) {
      alert('Desktop notifications are not supported in this browser.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      new Notification('TriVista GST', { body: 'Desktop alerts enabled.' });
    } else {
      alert('Desktop alerts were not allowed by the browser.');
    }
  };

  const desktopOn = 'Notification' in window && Notification.permission === 'granted';

  return (
    <div className="notif-wrap">
      <button className="btn btn-sm notif-bell" onClick={() => setOpen((o) => !o)} title="Notifications" style={{ position: 'relative' }}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="btn btn-sm" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="notif-list">
            {items.length === 0 && <div className="empty">Nothing to show yet.</div>}
            {items.map((n) => (
              <div
                key={n.id}
                className={'notif-item' + (n.is_read ? ' read' : '')}
                onClick={() => openItem(n)}
              >
                <span className={`notif-dot ${severityClass(n.severity)}`} />
                <div className="notif-body">
                  <div className="notif-title">{n.title}</div>
                  {n.message && <div className="notif-msg">{n.message}</div>}
                  <div className="notif-time">{ts(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="notif-foot">
            <button className="btn btn-sm" onClick={enableDesktop} disabled={desktopOn}>
              {desktopOn ? 'Desktop alerts on' : 'Enable desktop alerts'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}