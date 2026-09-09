import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

export default function InvoiceList() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const params = new URLSearchParams({ limit });
    if (status) params.set('status', status);
    if (q) params.set('q', q);
    if (page > 1) params.set('page', page);
    api.get(`/invoices?${params.toString()}`)
      .then((d) => { setRows(d.data || []); setTotal(d.total || 0); })
      .catch((e) => setError(e.message));
  };

  useEffect(load, [page, status]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="card">
      <div className="card-title">
        <span>Invoices</span>
        <Link to="/billing" className="btn btn-sm btn-primary">New Invoice</Link>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="row mb">
        <div>
          <label>Search</label>
          <input placeholder="Invoice no / customer" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())} />
        </div>
        <div>
          <label>Status</label>
          <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }}>
            <option value="">All</option>
            <option value="PENDING">Pending</option>
            <option value="PARTIAL">Partially Paid</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No invoices found.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Invoice No</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Type</th>
              <th className="right">Taxable</th>
              <th className="right">GST</th>
              <th className="right">Total</th>
              <th className="right">Due</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{r.invoice_number}</td>
                <td className="nowrap">{r.invoice_date}</td>
                <td>{r.customer_name}</td>
                <td className="muted">{r.invoice_type}{r.is_interstate ? '·IGST' : '·CGST/SGST'}</td>
                <td className="right nowrap">{inr(r.subtotal)}</td>
                <td className="right nowrap">{inr(r.tax_total)}</td>
                <td className="right nowrap"><strong>{inr(r.grand_total)}</strong></td>
                <td className="right nowrap">{r.status === 'PAID' ? '—' : inr(r.balance_due)}</td>
                <td><StatusBadge status={r.status} /></td>
                <td className="right"><Link to={`/invoices/${r.id}`} className="btn btn-sm">View</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {pages} ({total} invoices)</span>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}