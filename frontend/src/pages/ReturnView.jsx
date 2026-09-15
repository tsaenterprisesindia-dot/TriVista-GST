import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

export default function ReturnView() {
  const { id } = useParams();
  const [ret, setRet] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.get(`/returns/${id}`).then(setRet).catch((e) => setError(e.message));
  useEffect(load, [id]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!ret) return <div>Loading…</div>;

  const cn = ret.credit_note;
  const orig = ret.original_invoice;

  return (
    <>
      <div className="card">
        <div className="card-title">
          <span>Return {ret.return_number}</span>
          <Link to="/returns" className="btn btn-sm">Back to Returns</Link>
        </div>
        <div className="grid-2">
          <div>
            <div className="row"><div>Return Date</div><div className="right">{ret.return_date}</div></div>
            <div className="row">
              <div>Original Invoice</div>
              <div className="right">
                {orig ? <Link to={`/invoices/${orig.id}`}>{ret.invoice_number}</Link> : ret.invoice_number}
              </div>
            </div>
            <div className="row"><div>Customer</div><div className="right">{ret.customer_name}</div></div>
            <div className="row"><div>Type</div><div className="right">{ret.type}</div></div>
            {ret.reason && <div className="row"><div>Reason</div><div className="right">{ret.reason}</div></div>}
          </div>
          <div>
            <div className="row"><div>Returned Amount</div><div className="right nowrap">{inr(ret.grand_total)}</div></div>
            <div className="row"><div>Refunded</div><div className="right nowrap">{inr(ret.refunded_amount)}</div></div>
            <div className="row"><div>Refund Status</div><div className="right">{ret.refund_status}</div></div>
            {cn && (
              <div className="row">
                <div>Credit Note</div>
                <div className="right"><Link to={`/invoices/${cn.id}`}>{ret.credit_note_number}</Link></div>
              </div>
            )}
            {ret.exchange_invoice_id && (
              <div className="row">
                <div>Exchange Invoice</div>
                <div className="right"><Link to={`/invoices/${ret.exchange_invoice_id}`}>{ret.exchange_invoice_number}</Link></div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Returned Items</div>
        <table>
          <thead>
            <tr>
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
            {(ret.items || []).map((it) => (
              <tr key={it.id}>
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
          <div className="row"><div>Subtotal</div><div className="right nowrap">{inr(ret.subtotal)}</div></div>
          {Number(ret.discount) > 0 && <div className="row"><div>Discount</div><div className="right nowrap">-{inr(ret.discount)}</div></div>}
          <div className="row"><div>Tax</div><div className="right nowrap">{inr(ret.tax_total)}</div></div>
          <div className="row" style={{ borderTop: '2px solid var(--border)', paddingTop: 6, fontWeight: 700 }}>
            <div>Grand Total</div>
            <div className="right nowrap">{inr(ret.grand_total)}</div>
          </div>
        </div>
      </div>
    </>
  );
}