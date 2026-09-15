import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export default function ReturnCreate() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetInvoice = params.get('invoice');

  const [inv, setInv] = useState(null);
  const [invList, setInvList] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    invoice_id: presetInvoice || '',
    reason: '',
    date: new Date().toISOString().slice(0, 10),
    type: 'RETURN',
    refund_mode: 'REFUND',
    qty: {},
  });

  // Pick-a-sale list (only returnable documents).
  useEffect(() => {
    api.get('/invoices?limit=100')
      .then((d) => setInvList((d.data || []).filter((i) => ['B2B', 'B2C', 'EXPORT', 'NIL'].includes(i.invoice_type) && !['CANCELLED', 'RETURNED'].includes(i.status))))
      .catch((e) => setError(e.message));
  }, []);

  // Load the chosen invoice's detail (items include returned_qty).
  const loadInvoice = (id) => {
    if (!id) { setInv(null); return; }
    setError('');
    api.get(`/invoices/${id}`).then(setInv).catch((e) => setError(e.message));
  };
  useEffect(() => { if (form.invoice_id) loadInvoice(form.invoice_id); }, [form.invoice_id]);

  const setQty = (iiId, val) => {
    const n = Math.max(0, Number(val) || 0);
    setForm((f) => ({ ...f, qty: { ...f.qty, [iiId]: n } }));
  };

  const lines = useMemo(() => {
    if (!inv) return [];
    return (inv.items || [])
      .map((it) => ({
        ...it,
        available: r2(Number(it.quantity) - Number(it.returned_qty || 0)),
        retQty: r2(form.qty[it.id] || 0),
      }))
      .filter((it) => it.available > 0);
  }, [inv, form.qty]);

  const totals = useMemo(() => {
    let subtotal = 0, discount = 0, cgst = 0, sgst = 0, utgst = 0, igst = 0, cess = 0, grand = 0;
    for (const l of lines) {
      const ratio = r2(l.retQty / Number(l.quantity));
      subtotal += r2(Number(l.unit_price) * l.retQty);
      discount += r2(Number(l.discount) * ratio);
      cgst += r2(Number(l.cgst_amount) * ratio);
      sgst += r2(Number(l.sgst_amount) * ratio);
      utgst += r2(Number(l.utgst_amount) * ratio);
      igst += r2(Number(l.igst_amount) * ratio);
      cess += r2(Number(l.cess_amount) * ratio);
      grand += r2(Number(l.total) * ratio);
    }
    return {
      subtotal: r2(subtotal), discount: r2(discount),
      cgst: r2(cgst), sgst: r2(sgst), utgst: r2(utgst), igst: r2(igst), cess: r2(cess), grand: r2(grand),
    };
  }, [lines]);

  const selectedCount = lines.filter((l) => l.retQty > 0).length;

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    if (!form.invoice_id) { setError('Select the original invoice.'); return; }
    const items = lines.filter((l) => l.retQty > 0).map((l) => ({ invoice_item_id: l.id, quantity: l.retQty }));
    if (!items.length) { setError('Enter quantities for at least one line.'); return; }
    setSaving(true);
    try {
      const r = await api.post('/returns', { ...form, items });
      setMsg(`${r.message} · ${r.return_number}`);
      setTimeout(() => navigate(`/returns/${r.return_id}`), 700);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <div className="card-title">
        <span>New Return / Refund</span>
        <Link to="/returns" className="btn btn-sm">Back to Returns</Link>
      </div>
      {msg && <div className="success-banner">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      <form onSubmit={submit}>
        <div className="grid-2">
          <div>
            <label>Original Invoice</label>
            <select value={form.invoice_id} onChange={(e) => setForm((f) => ({ ...f, invoice_id: e.target.value }))}>
              <option value="">Select an invoice…</option>
              {invList.map((i) => (
                <option key={i.id} value={i.id}>{i.invoice_number} — {i.customer_name} ({inr(i.grand_total)})</option>
              ))}
            </select>
          </div>
          <div>
            <label>Return Date</label>
            <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="RETURN">Return</option>
              <option value="EXCHANGE">Exchange (return)</option>
            </select>
          </div>
          <div>
            <label>Refund Mode</label>
            <select value={form.refund_mode} onChange={(e) => setForm((f) => ({ ...f, refund_mode: e.target.value }))}>
              <option value="REFUND">Refund to original payment method</option>
              <option value="CREDIT">Credit to customer</option>
            </select>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <label>Reason</label>
            <input placeholder="e.g. damaged goods, wrong item" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
        </div>

        {inv && (
          <>
            <div className="muted mt">Invoice {inv.invoice_number} · Customer: {inv.customer_name} · Status: {inv.status}</div>
            {lines.length === 0 && <div className="empty mt">Nothing left to return on this invoice.</div>}
            {lines.length > 0 && (
              <table className="mt">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>HSN</th>
                    <th className="right">Rate</th>
                    <th className="right">Sold</th>
                    <th className="right">Returned</th>
                    <th className="right">Returnable</th>
                    <th className="right">Return Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.item_name}</td>
                      <td>{l.hsn_code || '—'}</td>
                      <td className="right nowrap">{inr(l.unit_price)}</td>
                      <td className="right">{l.quantity}</td>
                      <td className="right">{Number(l.returned_qty || 0)}</td>
                      <td className="right">{l.available}</td>
                      <td className="right">
                        <input
                          type="number"
                          min="0"
                          max={l.available}
                          step="0.01"
                          style={{ width: 90 }}
                          value={l.retQty || ''}
                          onChange={(e) => setQty(l.id, e.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ maxWidth: 380, marginLeft: 'auto', marginTop: 14 }}>
              <div className="row"><div>Subtotal</div><div className="right nowrap">{inr(totals.subtotal)}</div></div>
              {totals.discount > 0 && <div className="row"><div>Discount</div><div className="right nowrap">-{inr(totals.discount)}</div></div>}
              <div className="row"><div>GST</div><div className="right nowrap">{inr(totals.cgst + totals.sgst + totals.utgst + totals.igst + totals.cess)}</div></div>
              <div className="row" style={{ borderTop: '2px solid var(--border)', paddingTop: 6, fontWeight: 700 }}>
                <div>To be returned</div>
                <div className="right nowrap">{inr(totals.grand)}</div>
              </div>
              <div className="muted" style={{ fontSize: 12 }}>Refunds go back via the invoice's original payment method(s). Any value beyond what was paid becomes customer credit.</div>
            </div>

            <button className="btn btn-primary mt" disabled={saving || selectedCount === 0}>
              {saving ? 'Recording…' : `Record Return${selectedCount ? ` (${selectedCount} line${selectedCount > 1 ? 's' : ''})` : ''}`}
            </button>
          </>
        )}
      </form>
    </div>
  );
}