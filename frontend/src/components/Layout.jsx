import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import NotificationBell from './NotificationBell';

const navGroups = [
  {
    title: 'Main',
    items: [
      { to: '/', label: 'Dashboard', end: true },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/pos', label: 'POS', hideForViewer: true, feature: 'pos' },
      { to: '/pos/shortcuts', label: 'POS Shortcuts', feature: 'pos' },
      { to: '/billing', label: 'New Invoice', hideForViewer: true, feature: 'billing' },
      { to: '/invoices', label: 'Invoices', feature: 'billing' },
      { to: '/returns', label: 'Returns', feature: 'returns' },
      { to: '/recurring', label: 'Recurring', hideForViewer: true, feature: 'recurring' },
      { to: '/payment-links', label: 'Collect Payments', hideForViewer: true, hl: true, feature: 'paymentLinks' },
    ],
  },
  {
    title: 'Inventory & Parties',
    items: [
      { to: '/products', label: 'Products', hideForServices: true, hideForViewer: true, feature: 'products' },
      { to: '/inventory', label: 'Inventory', hideForServices: true, hideForViewer: true, feature: 'inventory' },
      { to: '/customers', label: 'Customers', hideForViewer: true, feature: 'customers' },
      { to: '/vendors', label: 'Vendors', hideForViewer: true, feature: 'vendors' },
    ],
  },
  {
    title: 'Finance & Reports',
    items: [
      { to: '/accounting', label: 'Accounting', hideForViewer: true, feature: 'accounting' },
      { to: '/reconciliation', label: 'Reconciliation', feature: 'reconciliation' },
      { to: '/review', label: 'Month Review', feature: 'gstReports' },
      { to: '/reports', label: 'GST Reports', feature: 'gstReports' },
      { to: '/tax-rates', label: 'GST Rates', hl: true, feature: 'gstReports' },
      { to: '/integration', label: 'e-Invoice / e-Way', feature: 'integration' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { to: '/assistant', label: 'AI Assistant', hideForViewer: true, feature: 'assistant' },
      { to: '/api-keys', label: 'API Keys', hideForViewer: true, hl: true, feature: 'apiKeys' },
      { to: '/audit', label: 'Audit Log', hl: true, feature: 'audit' },
      { to: '/users', label: 'Users', hideForViewer: true, superAdminOnly: true, hl: true, feature: 'users' },
      { to: '/licensing', label: 'Licensing & Sales', hideForViewer: true, hl: true, feature: 'licensing' },
      { to: '/settings', label: 'Settings', hideForViewer: true, hl: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/account', label: 'My Account' },
      { to: '/support', label: 'Support & Feedback' },
      { to: '/agreement', label: 'Terms & Conditions' },
    ],
  },
];

const modelLabel = (m) =>
  ({ general: 'General Business', manufacturing: 'Manufacturing', import_export: 'Import & Export' }[m] || 'General Business');

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [bizType, setBizType] = useState('mixed');
  const [model, setModel] = useState('general');
  const [features, setFeatures] = useState({});
  const [bizLoaded, setBizLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/model/features').catch(() => null),
      api.get('/company').catch(() => null),
    ])
      .then(([f, c]) => {
        if (c && c.business_type) setBizType(c.business_type);
        if (f && f.business_model) setModel(f.business_model);
        if (f && f.features) setFeatures(f.features);
      })
      .catch(() => {})
      .finally(() => setBizLoaded(true));
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visible = (item) =>
    !(item.hideForServices && bizType === 'services') &&
    !(item.hideForViewer && user?.role === 'VIEWER') &&
    !(item.superAdminOnly && user?.role !== 'SUPER_ADMIN') &&
    (item.feature ? features[item.feature] !== false : true);

  const navGroupsVisible = navGroups
    .map((g) => ({ title: g.title, items: g.items.filter(visible) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="TriVista GST logo" className="brand-logo" />
          <span className="brand-name">TriVista<span>GST</span></span>
          <span className="unit">A Unit of TSA Enterprises</span>
        </div>
        <nav className="sidebar-nav">
          {navGroupsVisible.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
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
            </div>
          ))}
        </nav>
        <div className="spacer" />
        {bizLoaded && (
          <div className="biz-badge" title="Business model (change in Settings)">{modelLabel(model)}</div>
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
