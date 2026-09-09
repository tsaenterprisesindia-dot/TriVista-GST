import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

function TaxBreakupLine({ label, value }) {
  if (!Number(value)) return null;
  return (
    <div className="row">
      <div>{label}</div>
      <div className="right nowrap">{inr(value)}</div>
    </div>
  );
}

export default function InvoiceView() {
  const { id } = useParams();
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [payForm, setPayForm] = useState({ amount: 0, mode: 'CASH', date: new Date().toISOString().slice(0, 10) });
  const [msg, setMsg] = useState('');

  const load = () => api.get(`/invoices/${id}`).then(setInv).catch((e) => setError(e.message));
  useEffect(load, [id]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!inv) return <div>Loading…</div>;

  const company = inv.company || {};
  const isInterstate = Number(inv.is_interstate) === 1;

  const recordPayment = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post(`/invoices/${inv.id}/pay`, payForm);
      setMsg('Payment recorded.');
      setPayForm((f) => ({ ...f, amount: 0 }));
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelInvoice = async () => {
    if (!window.confirm('Cancel this invoice? Stock will be restored.')) return;
    try {
      await api.post(`/invoices/${inv.id}/cancel`);
      setMsg('Invoice cancelled.');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {msg && <div className="success-banner">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="card no-print">
        <div className="flex" style={{ justifyContent: 'space-between' }}>
          <div className="flex">
            <h2>Invoice {inv.invoice_number}</h2>
            <StatusBadge status={inv.status} />
          </div>
          <div className="flex">
            <button className="btn btn-sm" onClick={() => window.print()}>Print / Save PDF</button>
            <Link className="btn btn-sm" to="/invoices">Back</Link>
          </div>
        </div>
        {inv.status !== 'CANCELLED' && inv.status !== 'PAID' && (
          <form onSubmit={recordPayment} className="row mt" style={{ maxWidth: 700 }}>
            <div>
              <label>Payment Amount</label>
              <input type="number" step="0.01" min="0" max={inv.balance_due} value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label>Mode</label>
              <select value={payForm.mode} onChange={(e) => setPayForm((f) => ({ ...f, mode: e.target.value }))}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="UPI">UPI</option>
                <option value="BANK">Bank</option>
              </select>
            </div>
            <div>
              <label>Date</label>
              <input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <button className="btn btn-primary" style={{ alignSelf: 'flex-end' }}>Record</button>
          </form>
        )}
        <div className="mt">
          {inv.status !== 'CANCELLED' && (
            <button className="btn btn-danger btn-sm" onClick={cancelInvoice}>Cancel Invoice</button>
          )}
        </div>
      </div>

      <div className="card" id="print-area">
        <div className="flex" style={{ justifyContent: 'space-between', borderBottom: '2px solid #111c34', paddingBottom: 12 }}>
          <div>
            <h2 style={{ color: '#111c34', margin: 0 }}>{company.company_name || 'Company'}</h2>
            <div className="muted">{company.address_line1}{company.city ? `, ${company.city}` : ''}</div>
            <div className="muted">{company.state ? `${company.state} ${company.pincode || ''}` : ''}</div>
            <div className="muted">{company.phone ? `Ph: ${company.phone}` : ''} {company.email ? `· ${company.email}` : ''}</div>
            {company.gstin && <div><strong>GSTIN: {company.gstin}</strong></div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <h2 style={{ margin: 0, color: '#111c34' }}>TAX INVOICE</h2>
            <div><strong>{inv.invoice_number}</strong></div>
            <div className="muted">Date: {inv.invoice_date}</div>
            {inv.irn && <div className="muted">IRN: {inv.irn}</div>}
            <div className="muted">Type: {inv.invoice_type} · {isInterstate ? 'Inter-state' : 'Intra-state'}</div>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 14 }}>
          <div>
            <div className="muted" style={{ fontSize: 11 }}>BILL TO</div>
            <div><strong>{inv.customer_name || inv.customer?.name}</strong></div>
            {inv.customer?.company_name && <div>{inv.customer.company_name}</div>}
            <div className="muted">{inv.customer?.address_line1}</div>
            <div className="muted">{inv.customer?.city} {inv.customer?.state} {inv.customer?.pincode}</div>
            <div>GSTIN: {inv.customer_gstin || 'URP'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 11 }}>SUMMARY</div>
            <div>Place of Supply: {inv.place_of_supply}</div>
            <div>Tax: {isInterstate ? 'IGST' : 'CGST + SGST'}</div>
            <div>Due Date: {inv.due_date || '—'}</div>
            <div>Payment Mode: {inv.payment_mode}</div>
          </div>
        </div>

        <table className="mt">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th>HSN</th>
              <th className="right">Qty</th>
              <th className="right">Rate</th>
              <th className="right">Disc</th>
              <th className="right">Taxable</th>
              <th className="right">GST%</th>
              <th className="right">GST Amt</th>
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {(inv.items || []).map((it, idx) => (
              <tr key={it.id}>
                <td>{idx + 1}</td>
                <td>{it.item_name}</td>
                <td>{it.hsn_code || '—'}</td>
                <td className="right">{it.quantity}</td>
                <td className="right nowrap">{inr(it.unit_price)}</td>
                <td className="right nowrap">{it.discount ? inr(it.discount) : '—'}</td>
                <td className="right nowrap">{inr(it.taxable_value)}</td>
                <td className="right">{it.gst_rate}%</td>
                <td className="right nowrap">{inr(Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.igst_amount))}</td>
                <td className="right nowrap">{inr(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ maxWidth: 380, marginLeft: 'auto', marginTop: 14 }}>
          <TaxBreakupLine label="Subtotal" value={inv.subtotal} />
          <TaxBreakupLine label="Discount" value={-inv.discount} />
          <TaxBreakupLine label="CGST" value={inv.cgst_total} />
          <TaxBreakupLine label="SGST" value={inv.sgst_total} />
          <TaxBreakupLine label="IGST" value={inv.igst_total} />
          <TaxBreakupLine label="Cess" value={inv.cess_total} />
          <TaxBreakupLine label="Round Off" value={inv.round_off} />
          <div className="row" style={{ borderTop: '2px solid #111c34', paddingTop: 6, fontWeight: 700, fontSize: 16 }}>
            <div>Grand Total</div>
            <div className="right nowrap">{inr(inv.grand_total)}</div>
          </div>
          <div className="row mt">
            <div className="muted">Paid</div>
            <div className="right nowrap">{inr(inv.paid_amount)}</div>
          </div>
          <div className="row">
            <div className="muted">Balance Due</div>
            <div className="right nowrap">{inr(inv.balance_due)}</div>
          </div>
        </div>

        {inv.notes && <div className="muted mt">Note: {inv.notes}</div>}
        {company.invoice_footer_note && (
          <div className="muted mt" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            {company.invoice_footer_note}
          </div>
        )}
        {company.bank_account_no && (
          <div className="muted mt" style={{ fontSize: 12 }}>
            Bank: {company.bank_name} · A/c: {company.bank_account_no} · IFSC: {company.bank_ifsc}
          </div>
        )}
      </div>
    </>
  );
}