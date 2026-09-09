import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/pos', label: 'POS' },
  { to: '/billing', label: 'New Invoice' },
  { to: '/invoices', label: 'Invoices' },
  { to: '/products', label: 'Products' },
  { to: '/inventory', label: 'Inventory' },
  { to: '/customers', label: 'Customers' },
  { to: '/vendors', label: 'Vendors' },
  { to: '/accounting', label: 'Accounting' },
  { to: '/reports', label: 'GST Reports' },
  { to: '/reconciliation', label: 'Reconciliation' },
  { to: '/integration', label: 'e-Invoice / e-Way' },
  { to: '/assistant', label: 'AI Assistant' },
  { to: '/api-keys', label: 'API Keys' },
  { to: '/settings', label: 'Settings', hl: true },
  { to: '/users', label: 'Users', hl: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

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
        <a href="#logout" className="logout hl" onClick={(e) => { e.preventDefault(); handleLogout(); }}>
          Logout
        </a>
      </aside>
      <div className="main">
        <div className="topbar">
          <h1>TriVista GST<span className="unit">A Unit of TSA Enterprises</span></h1>
          <div className="flex">
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
