import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Link } from 'react-router-dom';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get('/reports/dashboard')
      .then(setD)
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error-banner">{error}</div>;
  if (!d) return <div>Loading dashboard…</div>;

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card">
          <div className="label">Today's Sales</div>
          <div className="value">{inr(d.salesToday)}</div>
          <div className="sub">{d.salesTodayCount} invoice(s)</div>
        </div>
        <div className="stat-card">
          <div className="label">This Month</div>
          <div className="value">{inr(d.monthSales)}</div>
          <div className="sub">{d.monthSalesCount} invoice(s)</div>
        </div>
        <div className="stat-card">
          <div className="label">GST Collected (All time)</div>
          <div className="value">{inr(d.gstCollected)}</div>
          <div className="sub">CGST + SGST + IGST + Cess</div>
        </div>
        <div className="stat-card">
          <div className="label">Receivables</div>
          <div className="value">{inr(d.receivables)}</div>
          <div className="sub">{d.receivablesCount} invoice(s) pending</div>
        </div>
        <div className="stat-card">
          <div className="label">Stock Value</div>
          <div className="value">{inr(d.stockValue)}</div>
          <div className="sub">At purchase cost</div>
        </div>
      </div>

      {d.lowStock?.length > 0 && (
        <div className="card">
          <div className="card-title">Low Stock Alerts</div>
          <table>
            <thead><tr><th>Product</th><th>On Hand</th><th>Min Level</th></tr></thead>
            <tbody>
              {d.lowStock.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td><span className="badge badge-red">{s.on_hand}</span></td>
                  <td>{s.min_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Recent Invoices <Link to="/invoices" className="btn btn-sm">View all</Link></div>
          <table>
            <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th className="right">Total</th><th>Status</th></tr></thead>
            <tbody>
              {d.recentInvoices.map((inv) => (
                <tr key={inv.invoice_number}>
                  <td className="nowrap">{inv.invoice_number}</td>
                  <td className="nowrap">{inv.invoice_date}</td>
                  <td>{inv.customer_name}</td>
                  <td className="right nowrap">{inr(inv.grand_total)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-title">Top Customers</div>
          <table>
            <thead><tr><th>Customer</th><th>Invoices</th><th className="right">Total</th></tr></thead>
            <tbody>
              {d.topCustomers.map((c) => (
                <tr key={c.customer_name}>
                  <td>{c.customer_name}</td>
                  <td>{c.invoices}</td>
                  <td className="right nowrap">{inr(c.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export function StatusBadge({ status }) {
  const map = {
    PAID: <span className="badge badge-green">PAID</span>,
    PENDING: <span className="badge badge-amber">PENDING</span>,
    PARTIAL: <span className="badge badge-blue">PARTIAL</span>,
    DRAFT: <span className="badge badge-gray">DRAFT</span>,
    CANCELLED: <span className="badge badge-red">CANCELLED</span>,
    RETURNED: <span className="badge badge-gray">RETURNED</span>,
  };
  return map[status] || <span className="badge badge-gray">{status}</span>;
}