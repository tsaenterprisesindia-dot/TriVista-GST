import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const badge = {
  active: <span className="badge badge-green">ACTIVE</span>,
  paid: <span className="badge badge-blue">PAID</span>,
  cancelled: <span className="badge badge-gray">CANCELLED</span>,
};

export default function PaymentLinks() {
  const [rows, setRows] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ invoice_id: '', amount: '', note: '' });
  const [copyId, setCopyId] = useState(null);

  const load = () => {
    setLoading(true);
    api
      .get('/payment-links')
      .then((d) => setRows(d.data || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api
      .get('/payment-links/invoices')
      .then((d) => setInvoices(d.data || []))
      .catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickInvoice = (e) => {
    const id = e.target.value;
    const inv = invoices.find((i) => String(i.id) === id);
    setForm((f) => ({
      ...f,
      invoice_id: id,
      amount: inv ? String(inv.balance_due) : f.amount,
      note: inv ? `Invoice ${inv.invoice_number}` : f.note,
    }));
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      const r = await api.post('/payment-links', {
        invoice_id: form.invoice_id || undefined,
        amount: form.amount || undefined,
        note: form.note || undefined,
      });
      setSaved(`Payment link created: ${r.url}`);
      setShowForm(false);
      setForm({ invoice_id: '', amount: '', note: '' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const action = async (fn, okMsg) => {
    setError('');
    setSaved('');
    try {
      const r = await fn();
      setSaved(r.message || okMsg);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const copy = async (row) => {
    const url = `${window.location.origin}/pay/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopyId(row.id);
      setSaved('Link copied to clipboard.');
      setTimeout(() => setCopyId(null), 1500);
    } catch (_) {
      window.prompt('Copy this link:', url);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            Collect Payments via UPI
            <img src="/upi.svg" alt="UPI" width="43" height="20" style={{ marginTop: 2 }} />
          </span>
          <button className="btn btn-primary" onClick={() => setShowForm((s) => !s)}>
            {showForm ? 'Close' : '+ New Payment Link'}
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Share a link with any buyer — it opens a page with your UPI QR and tap-to-pay. Add your UPI ID in
          Settings → UPI Payments first. After the money arrives, mark the link paid to close it.
        </div>

        {showForm && (
          <form onSubmit={create} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Invoice (optional)</label>
                <select value={form.invoice_id} onChange={pickInvoice}>
                  <option value="">— Standalone amount —</option>
                  {invoices.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.invoice_number} · {i.customer_name} · {inr(i.balance_due)} due
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Amount (₹)</label>
                <input value={form.amount} onChange={set('amount')} type="number" min="0" step="0.01" />
              </div>
              <div className="field">
                <label>Note (shown on pay page)</label>
                <input value={form.note} onChange={set('note')} placeholder="e.g. Software licence - TriVista GST" />
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">Create Link</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Payment Links</div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No payment links yet. Create one to start collecting.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th className="right">Amount</th>
                <th>Invoice</th>
                <th>Note</th>
                <th>Created</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">••••{r.token.slice(-8)}</td>
                  <td className="right nowrap">{inr(r.amount)}</td>
                  <td className="nowrap">{r.invoice_number || '—'}</td>
                  <td>{r.note || '—'}</td>
                  <td style={{ fontSize: 12 }}>{new Date(r.created_at + 'Z').toLocaleString()}</td>
                  <td>{badge[r.status] || r.status}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => copy(r)}>
                      {copyId === r.id ? 'Copied ✓' : 'Copy Link'}
                    </button>{' '}
                    <a className="btn btn-sm" href={`/pay/${r.token}`} target="_blank" rel="noreferrer">Open</a>{' '}
                    {r.status === 'active' && (
                      <>
                        <button
                          className="btn btn-sm btn-success"
                          onClick={() => action(() => api.post(`/payment-links/${r.token}/mark-paid`), 'Marked paid.')}
                        >
                          Mark Paid
                        </button>{' '}
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => action(() => api.post(`/payment-links/${r.token}/cancel`), 'Cancelled.')}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}