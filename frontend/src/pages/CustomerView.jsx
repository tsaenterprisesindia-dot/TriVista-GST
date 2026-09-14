import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

function Card({ label, value, tone }) {
  return (
    <div className={tone ? `card ${tone}` : 'card'} style={{ padding: '12px 14px' }}>
      <div className="muted" style={{ fontSize: 11.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

export default function CustomerView() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/customers/${id}/history`).then(setData).catch((e) => setError(e.message));
  }, [id]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!data) return <div>Loading…</div>;

  const c = data.customer || {};
  const s = data.summary || {};
  const invoices = data.invoices || [];
  const payments = data.payments || [];

  return (
    <>
      <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <Link to="/customers" className="muted" style={{ fontSize: 13 }}>← Back to Customers</Link>
          <h2 style={{ margin: '4px 0 0' }}>{c.name}</h2>
          <div className="muted">{c.customer_code} · {c.legal_name || '—'}{c.company_name ? ` · ${c.company_name}` : ''}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div><strong>GSTIN:</strong> {c.gstin || 'URP'} {c.registration_category ? <span className="badge badge-blue">{c.registration_category.toUpperCase()}</span> : null}</div>
          <div className="muted" style={{ fontSize: 12 }}>{c.phone ? `Ph: ${c.phone}  ` : ''}{c.email ? c.email : ''}</div>
          <div className="muted" style={{ fontSize: 12 }}>{c.address_line1 ? `${c.address_line1}, ` : ''}{c.city ? `${c.city}, ` : ''}{c.state ? `${c.state} ` : ''}{c.pincode || ''}</div>
        </div>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <Card label="Invoices" value={s.invoice_count || 0} />
        <Card label="Total Sales (taxable)" value={inr(s.total_sales)} />
        <Card label="GST Collected" value={inr(s.total_gst)} />
        <Card label="Total Paid" value={inr(s.total_paid)} />
        <Card
          label="Balance Due"
          value={<span className={Number(s.total_due) > 0 ? 'badge badge-red' : 'badge badge-green'}>{inr(s.total_due)}</span>}
        />
        <Card
          label="Credit Limit"
          value={c.credit_limit ? inr(c.credit_limit) : '—'}
        />
        {(s.first_invoice_date && s.last_invoice_date) && (
          <Card label="Active From → To" value={<span style={{ fontSize: 12 }}>{s.first_invoice_date} → {s.last_invoice_date}</span>} />
        )}
      </div>

      <div className="card mt">
        <div className="card-title">Purchase History ({invoices.length})</div>
        {invoices.length === 0 ? (
          <div className="empty">No invoices for this customer yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Type</th>
                <th className="right">Taxable</th>
                <th className="right">GST</th>
                <th className="right">Grand</th>
                <th className="right">Paid</th>
                <th className="right">Due</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td className="nowrap"><Link to={`/invoices/${inv.id}`}>{inv.invoice_number}</Link></td>
                  <td className="nowrap">{inv.invoice_date}</td>
                  <td>{inv.invoice_type}{inv.against_invoice_no ? ` → ${inv.against_invoice_no}` : ''}</td>
                  <td className="right nowrap">{inr(inv.subtotal)}</td>
                  <td className="right nowrap">{inr(inv.tax_total)}</td>
                  <td className="right nowrap">{inr(inv.grand_total)}</td>
                  <td className="right nowrap">{inr(inv.paid_amount)}</td>
                  <td className="right nowrap">{inr(inv.balance_due)}</td>
                  <td><StatusBadge status={inv.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card mt">
        <div className="card-title">Payments Received ({payments.length})</div>
        {payments.length === 0 ? (
          <div className="empty">No payments recorded for this customer yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="right">Amount</th>
                <th>Mode</th>
                <th>Reference</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{p.date}</td>
                  <td className="right nowrap">{inr(p.amount)}</td>
                  <td>{p.mode}</td>
                  <td className="nowrap">{p.reference_no || '—'}</td>
                  <td className="muted">{p.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}