import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const refundBadge = (s) => {
  const map = { REFUNDED: ['Refunded', 'ok'], PARTIAL: ['Partially Refunded', 'warn'], CREDITED: ['Credited', 'muted'], PENDING: ['Pending', 'muted'] };
  const [label, cls] = map[s] || [s, 'muted'];
  return <span className={`badge ${cls}`}>{label}</span>;
};

export default function Returns() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const params = new URLSearchParams({ limit });
    if (q) params.set('q', q);
    if (page > 1) params.set('page', page);
    api.get(`/returns?${params.toString()}`)
      .then((d) => { setRows(d.data || []); setTotal(d.total || 0); })
      .catch((e) => setError(e.message));
  };

  useEffect(load, [page]);

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="card">
      <div className="card-title">
        <span>Sales Returns</span>
        <Link to="/returns/new" className="btn btn-sm btn-primary">New Return</Link>
      </div>
      {error && <div className="error-banner">{error}</div>}

      <div className="row mb">
        <div>
          <label>Search</label>
          <input placeholder="Return no / invoice no / customer" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">No returns found.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Return No</th>
              <th>Date</th>
              <th>Invoice</th>
              <th>Customer</th>
              <th>Type</th>
              <th className="right">Returned Amt</th>
              <th className="right">Refunded</th>
              <th>Refund Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/returns/${r.id}`}>{r.return_number}</Link></td>
                <td>{r.return_date}</td>
                <td>{r.invoice_number}</td>
                <td>{r.customer_name || r.customer_display}</td>
                <td>{r.type}</td>
                <td className="right nowrap">{inr(r.grand_total)}</td>
                <td className="right nowrap">{inr(r.refunded_amount)}</td>
                <td>{refundBadge(r.refund_status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pages > 1 && (
        <div className="flex mt">
          <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span className="muted">Page {page} of {pages}</span>
          <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </div>
  );
}