import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Link } from 'react-router-dom';

const fmt = (n, d = 0) =>
  new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: 2 }).format(Number(n) || 0);

export default function ReviewDashboard() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError('');
    api
      .get(`/reports/month-review?month=${month}`)
      .then(setR)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <>
      <div className="card">
        <div className="card-title">
          Month-End Review
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ marginRight: 12 }} />
        </div>
        {error && <div className="error-banner">{error}</div>}
        {!r || loading ? <div className="empty">Loading…</div> : (
          <>
            <div className="stats-grid">
              <div className="stat-card">
                <div className="label">Sales (gross)</div>
                <div className="value">{fmt(r.sales.grand_total)}</div>
                <div className="sub">{r.sales.count} invoice(s)</div>
              </div>
              <div className="stat-card">
                <div className="label">Purchases (gross)</div>
                <div className="value">{fmt(r.purchases.grand_total)}</div>
                <div className="sub">{r.purchases.count} bill(s) · {Number(r.purchases.rcm_bills)} RCM</div>
              </div>
              <div className="stat-card">
                <div className="label">Revenue (net of CN/DN)</div>
                <div className="value">{fmt(r.revenue)}</div>
                <div className="sub">{r.credit_notes.count} credit/debit note(s) · {fmt(r.credit_notes.total)}</div>
              </div>
              <div className="stat-card">
                <div className="label">Margin (taxable)</div>
                <div className="value">{fmt(r.margin_estimate)}</div>
                <div className="sub">Sales − purchases (all rates)</div>
              </div>
              <div className="stat-card">
                <div className="label">Output GST</div>
                <div className="value">{fmt(r.output_tax)}</div>
                <div className="sub">CGST + SGST + IGST + Cess</div>
              </div>
              <div className="stat-card">
                <div className="label">Input ITC</div>
                <div className="value">{fmt(r.input_tax)}</div>
                <div className="sub">On purchases (excl. RCM)</div>
              </div>
              <div className="stat-card">
                <div className="label">Net GST Payable</div>
                <div className="value">{fmt(r.net_gst_payable)}</div>
                <div className="sub">Output − input (before adjustments)</div>
              </div>
              <div className="stat-card">
                <div className="label">RCM Tax Payable</div>
                <div className="value">{fmt(r.rcm_tax)}</div>
                <div className="sub">From unregistered suppliers</div>
              </div>
              <div className="stat-card">
                <div className="label">Receivables (total)</div>
                <div className="value">{fmt(r.receivables.total)}</div>
                <div className="sub">{r.receivables.count} invoice(s)</div>
              </div>
              <div className="stat-card">
                <div className="label">Payables (total)</div>
                <div className="value">{fmt(r.payables.total)}</div>
                <div className="sub">{r.payables.count} bill(s)</div>
              </div>
              <div className="stat-card" style={Number(r.pending_irn) > 0 ? { border: '1px solid var(--red)' } : {}}>
                <div className="label">e-Invoice Pending IRN</div>
                <div className="value">{r.pending_irn}</div>
                <div className="sub">B2B/Export invoices without IRN</div>
              </div>
            </div>

            {r.pending_irn > 0 && (
              <div className="error-banner">
                {r.pending_irn} invoice(s) this month do not have an IRN yet. Generate before the filing due date.
              </div>
            )}

            {r.due_invoices.length > 0 && (
              <div className="card">
                <div className="card-title">Oldest Outstanding Invoices <Link to="/invoices" className="btn btn-sm">View all</Link></div>
                <table>
                  <thead><tr><th>No.</th><th>Date</th><th>Customer</th><th className="right">Total</th><th className="right">Due</th></tr></thead>
                  <tbody>
                    {r.due_invoices.map((i) => (
                      <tr key={i.invoice_number}>
                        <td className="nowrap">{i.invoice_number}</td>
                        <td className="nowrap">{i.invoice_date}</td>
                        <td>{i.customer_name}</td>
                        <td className="right nowrap">{fmt(i.grand_total)}</td>
                        <td className="right nowrap">{fmt(i.balance_due)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}