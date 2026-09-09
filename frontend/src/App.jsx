import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Billing from './pages/Billing';
import InvoiceList from './pages/InvoiceList';
import InvoiceView from './pages/InvoiceView';
import POS from './pages/POS';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import Vendors from './pages/Vendors';
import Recurring from './pages/Recurring';
import Reports from './pages/Reports';
import Accounting from './pages/Accounting';
import Integration from './pages/Integration';
import Reconciliation from './pages/Reconciliation';
import AIAssistant from './pages/AIAssistant';
import ApiKeys from './pages/ApiKeys';
import Audit from './pages/Audit';
import CompanySettings from './pages/CompanySettings';
import Users from './pages/Users';

function Protected({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="content">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="content">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route
        path="/"
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="billing" element={<Billing />} />
        <Route path="invoices" element={<InvoiceList />} />
        <Route path="invoices/:id" element={<InvoiceView />} />
        <Route path="pos" element={<POS />} />
        <Route path="products" element={<Products />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="customers" element={<Customers />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="reports" element={<Reports />} />
        <Route path="accounting" element={<Accounting />} />
        <Route path="integration" element={<Integration />} />
        <Route path="reconciliation" element={<Reconciliation />} />
        <Route path="assistant" element={<AIAssistant />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<CompanySettings />} />
        <Route path="users" element={<Users />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;