import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import NotificationBell from './NotificationBell';

const allNavItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/pos', label: 'POS' },
  { to: '/billing', label: 'New Invoice' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/products', label: 'Products', hideForServices: true },
  { to: '/inventory', label: 'Inventory', hideForServices: true },
  { to: '/customers', label: 'Customers' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/recurring', label: 'Recurring' },
  { to: '/accounting', label: 'Accounting' },
  { to: '/reports', label: 'GST Reports' },
  { to: '/reconciliation', label: 'Reconciliation' },
  { to: '/integration', label: 'e-Invoice / e-Way' },
  { to: '/assistant', label: 'AI Assistant' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/audit', label: 'Audit Log', hl: true },
  { to: '/settings', label: 'Settings', hl: true },
  { to: '/users', label: 'Users', hl: true },
];

const labelFor = (t) =>
  ({ retail: 'Products (Retail)', wholesale: 'Products (Wholesale)', services: 'Services', mixed: 'Products & Services' }[t] || 'Products & Services');

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [bizType, setBizType] = useState('mixed');
  const [bizLoaded, setBizLoaded] = useState(false);

  useEffect(() => {
    api
      .get('/company')
      .then((d) => {
        if (d.business_type) setBizType(d.business_type);
      })
      .catch(() => {})
      .finally(() => setBizLoaded(true));
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const navItems = allNavItems.filter((it) => !(it.hideForServices && bizType === 'services'));

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="TriVista GST logo" className="brand-logo" />
          <span className="brand-name">TriVista<span>GST</span></span>
          <span className="unit">A Unit of TSA Enterprises</span>
        </div>
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                [item.hl ? 'hl' : '', isActive ? 'active' : ''].filter(Boolean).join(' ') || undefined
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="spacer" />
        {bizLoaded && (
          <div className="biz-badge" title="Business type (change in Settings)">{labelFor(bizType)}</div>
        )}
        <a href="#logout" className="logout hl" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
          Logout
        </a>
      </aside>
      <div className="main">
        <div className="topbar">
          <h1>TriVista GST<span className="unit">A Unit of TSA Enterprises</span></h1>
          <div className="flex">
            <NotificationBell />
            <NavLink to="/assistant" className="btn btn-sm ai-top-btn">AI Assistant</NavLink>
            <span className="muted">{user?.name} · {user?.role?.replace('_', ' ')}</span>
          </div>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
