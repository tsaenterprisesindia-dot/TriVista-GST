import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';
import PaymentSplit from '../components/PaymentSplit';

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
  const [payForm, setPayForm] = useState({ amount: 0, mode: 'CASH', date: new Date().toISOString().slice(0, 10), payments: [] });
  const [msg, setMsg] = useState('');

  const load = () => api.get(`/invoices/${id}`).then(setInv).catch((e) => setError(e.message));
  useEffect(load, [id]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!inv) return <div>Loading…</div>;

  const company = inv.company || {};
  const isInterstate = Number(inv.is_interstate) === 1;
  const isUtInvoice = Number(inv.utgst_total) > 0;

  const amountInWords = (n) => {
    if (isNaN(n)) return '';
    if (n === 0) return 'Zero';
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (v) => {
      if (v < 20) return ones[v];
      return tens[Math.floor(v / 10)] + (v % 10 ? ' ' + ones[v % 10] : '');
    };
    const three = (v) => {
      const h = Math.floor(v / 100);
      const rest = v % 100;
      return (h ? (two(h) + ' Hundred' + (rest ? ' ' : '')) : '') + (rest ? two(rest) : '');
    };
    const convert = (amt) => {
      const parts = [];
      const crore = Math.floor(amt / 10000000);
      const lakh = Math.floor((amt % 10000000) / 100000);
      const thousand = Math.floor((amt % 100000) / 1000);
      const remainder = Math.round(amt % 1000);
      if (crore) parts.push(convert(crore) + ' Crore');
      if (lakh) parts.push(two(lakh) + ' Lakh');
      if (thousand) parts.push(two(thousand) + ' Thousand');
      if (remainder) parts.push(three(remainder));
      return parts.join(' ');
    };
    const abs = Math.abs(Math.round(Math.abs(n) * 100)) / 100;
    const rupees = Math.floor(abs);
    const paise = Math.round((abs - rupees) * 100);
    let w = convert(rupees) + ' Rupees';
    if (paise > 0) {
      w += ' and ' + convert(paise) + ' Paise';
    }
    return w + ' Only';
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    setMsg('');
    try {
      await api.post(`/invoices/${inv.id}/pay`, payForm);
      setMsg('Payment recorded.');
      setPayForm((f) => ({ ...f, amount: 0, payments: [] }));
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const cancelInvoice = async () => {
    const reason = window.prompt('Cancellation reason (shown in audit & IRP cancel request):', 'Duplicate / wrong entry');
    if (reason === null) return;
    if (!window.confirm(`Cancel invoice ${inv.invoice_number}? Stock will be restored.${inv.irn ? ' Its live IRN will also be cancelled (24h window).' : ''}`)) return;
    setError('');
    try {
      const r = await api.post(`/invoices/${inv.id}/cancel`, { reason: reason.trim() });
      setMsg(`Invoice cancelled.${r.irn_cancelled ? ' IRN cancelled at IRP.' : ' (no live IRN to cancel)'}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const printReceipt = () => {
    const pays = inv.payments || [];
    const rows = pays.length
      ? `<table style="width:100%;border-collapse:collapse;margin-top:10px">
           <tr><th style="text-align:left;padding:4px;border-bottom:1px solid #999">Date</th>
               <th style="text-align:right;padding:4px;border-bottom:1px solid #999">Mode</th>
               <th style="text-align:right;padding:4px;border-bottom:1px solid #999">Amount</th></tr>
           ${pays
             .map(
               (p) =>
                 `<tr><td style="padding:4px">${p.date}</td><td style="padding:4px;text-align:right">${p.mode}</td><td style="padding:4px;text-align:right">${inr(p.amount)}</td></tr>`
             )
             .join('')}
           <tr><td colspan="2" style="padding:4px;text-align:right"><strong>Total paid</strong></td>
               <td style="padding:4px;text-align:right"><strong>${inr(inv.paid_amount)}</strong></td></tr>
         </table>`
      : `<div class="muted" style="margin-top:10px">No payments recorded yet.</div>`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payment Receipt</title>
      <style>body{font-family:Arial,sans-serif;max-width:520px;margin:24px auto;padding:16px;color:#111}
      .muted{color:#666;font-size:13px}h1{font-size:20px;margin:0}.right{text-align:right}
      .sep{border-top:2px solid #111;margin:12px 0}</style></head><body>
      <h1>${company.legal_name || company.company_name || 'Company'}</h1>
      <div class="muted">${company.address_line1 || ''} ${company.city || ''} ${company.state || ''} ${company.pincode || ''}</div>
      ${company.gstin ? `<div class="muted">GSTIN: ${company.gstin}</div>` : ''}
      <div class="muted">${company.phone || ''} ${company.email || ''}</div>
      <div class="sep"></div>
      <div style="text-align:center;font-weight:bold;letter-spacing:1px">PAYMENT RECEIPT</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px">
        <div class="muted">Invoice: <strong style="color:#111">${inv.invoice_number}</strong></div>
        <div class="muted">Date: ${new Date().toISOString().slice(0, 10)}</div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <div>Received from: <strong>${inv.customer_name || 'Walk-in Customer'}</strong></div>
        <div class="right">GSTIN: ${inv.customer_gstin || 'URP'}</div>
      </div>
      ${rows}
      <div style="margin-top:10px;font-size:13px" class="muted">Thank you for your business!</div>
      <script>setTimeout(function(){window.focus();window.print();},250);<\\/script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=600,height=800');
    if (!w) { alert('Please allow pop-ups to print the receipt.'); return; }
    w.document.write(html);
    w.document.close();
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
            {['B2B', 'B2C', 'EXPORT', 'NIL'].includes(inv.invoice_type) && !['CANCELLED', 'RETURNED'].includes(inv.status) && (
              <Link className="btn btn-sm btn-primary" to={`/returns/new?invoice=${inv.id}`}>Return Items</Link>
            )}
            {(inv.payments || []).length > 0 && (
              <button className="btn btn-sm" onClick={printReceipt}>Payment Receipt</button>
            )}
            <Link className="btn btn-sm" to="/invoices">Back</Link>
          </div>
        </div>
        {inv.status !== 'CANCELLED' && inv.status !== 'PAID' && (
          <form onSubmit={recordPayment} className="mt" style={{ maxWidth: 700 }}>
            <div className="row mb">
              <div>
                <label>Payment Date</label>
                <input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} />
              </div>
              <div className="muted" style={{ alignSelf: 'flex-end', fontSize: 12 }}>Balance due: {inr(inv.balance_due)}</div>
            </div>
            <PaymentSplit
              total={inv.balance_due}
              value={payForm.payments || []}
              onChange={(rows) => setPayForm((f) => ({ ...f, payments: rows }))}
              withReference
              label="Payment"
            />
            <button className="btn btn-primary mt" style={{ alignSelf: 'flex-end' }}>Record Payment</button>
          </form>
        )}
        <div className="mt">
          {inv.status !== 'CANCELLED' && (
            <button className="btn btn-danger btn-sm" onClick={cancelInvoice}>Cancel Invoice</button>
          )}
        </div>
      </div>

      {(inv.payments || []).length > 0 && (
        <div className="card no-print">
          <div className="card-title">Payments</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Mode</th>
                <th className="right">Amount</th>
                <th>Reference</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {(inv.payments || []).map((p) => (
                <tr key={p.id}>
                  <td>{p.date}</td>
                  <td>{p.mode}</td>
                  <td className="right nowrap">{inr(p.amount)}</td>
                  <td>{p.reference_no || '—'}</td>
                  <td className="muted">{p.note || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card" id="print-area">
        <div className="flex" style={{ justifyContent: 'space-between', borderBottom: '2px solid #111c34', paddingBottom: 12 }}>
          <div>
            <h2 style={{ color: '#111c34', margin: 0 }}>{company.trade_name || company.legal_name || company.company_name || 'Company'}</h2>
            {company.legal_name && company.trade_name && company.legal_name !== company.trade_name && (
              <div className="muted">Legal Name: {company.legal_name}</div>
            )}
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
            {inv.qr_url && <img src={inv.qr_url} alt="IRN QR" style={{ width: 80, height: 80, marginTop: 6, border: '1px solid #ddd', borderRadius: 6 }} />}
            <div className="muted">Type: {inv.invoice_type} · {isInterstate ? 'Inter-state' : 'Intra-state'}</div>
            {inv.against_invoice_no && <div className="muted">Adjusts: {inv.against_invoice_no}</div>}
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
            <div>Tax: {isInterstate ? 'IGST' : isUtInvoice ? 'CGST + UTGST' : 'CGST + SGST'}{Number(inv.cess_total) > 0 ? ' + Cess' : ''}</div>
            <div>Due Date: {inv.due_date || '—'}</div>
            <div>Payment Mode: {inv.payment_mode}</div>
            {(inv.payments || []).length > 0 && (
              <div className="muted" style={{ fontSize: 11 }}>
                {inv.payments.map((p) => `${p.mode} ${inr(p.amount)}`).join(' + ')}
              </div>
            )}
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
                <td className="right nowrap">{inr(Number(it.cgst_amount) + Number(it.sgst_amount) + Number(it.utgst_amount) + Number(it.igst_amount))}</td>
                <td className="right nowrap">{inr(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ maxWidth: 380, marginLeft: 'auto', marginTop: 14 }}>
          <TaxBreakupLine label="Subtotal" value={inv.subtotal} />
          <TaxBreakupLine label="Discount" value={-inv.discount} />
          <TaxBreakupLine label="CGST" value={inv.cgst_total} />
          {Number(inv.sgst_total) > 0 && <TaxBreakupLine label="SGST" value={inv.sgst_total} />}
          {Number(inv.utgst_total) > 0 && <TaxBreakupLine label="UTGST" value={inv.utgst_total} />}
          <TaxBreakupLine label="IGST" value={inv.igst_total} />
          <TaxBreakupLine label="Cess" value={inv.cess_total} />
          {Number(inv.tcs_amount) > 0 && <TaxBreakupLine label="TCS (u/s 206C(1H))" value={inv.tcs_amount} />}
          <TaxBreakupLine label="Round Off" value={inv.round_off} />
          <div className="row" style={{ borderTop: '2px solid #111c34', paddingTop: 6, fontWeight: 700, fontSize: 16 }}>
            <div>Grand Total</div>
            <div className="right nowrap">{inr(inv.grand_total)}</div>
          </div>
          <div className="row mt" style={{ fontSize: 12, fontStyle: 'italic' }}>
            <div>Amount in words:</div>
            <div className="right">{(inv.invoice_type === 'CREDIT_NOTE' || inv.invoice_type === 'DEBIT_NOTE' ? 'Minus ' : '') + amountInWords(inv.grand_total)}</div>
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
        <div className="flex" style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 10 }}>
          <span className="muted" style={{ fontSize: 11 }}>
            This is a computer-generated invoice{inv.irn ? ' (IRN registered, e-invoice compliant)' : ''} and is valid without a signature.
          </span>
          <span style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 11 }}>For {company.legal_name || company.company_name || 'Company'}</div>
            <div style={{ height: 42 }} />
            <div style={{ borderTop: '1px solid #111', width: 200, marginLeft: 'auto', fontSize: 11 }}>Authorised Signatory</div>
          </span>
        </div>
      </div>
    </>
  );
}