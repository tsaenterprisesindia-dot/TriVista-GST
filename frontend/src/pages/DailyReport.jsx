import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const MODE_LABEL = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK: 'Bank Transfer', OTHER: 'Other' };

export default function DailyReport() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api.get(`/reports/daily?date=${encodeURIComponent(date)}`)
      .then((d) => setData(d))
      .catch((e) => setError(e.message || 'Failed to load daily report.'));
  };

  useEffect(load, [date]);

  const s = data?.sales;
  const totalGst = [s?.cgst, s?.sgst, s?.utgst, s?.igst, s?.cess].reduce((a, b) => a + Number(b || 0), 0);

  return (
    <div className="page">
      <div className="card">
        <div className="flex" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>Daily Sales Report (DSR)</div>
          <div className="flex">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn btn-sm" onClick={() => window.print()}>Print</button>
          </div>
        </div>
        {error && <div className="alert">{error}</div>}

        {data && s && (
          <>
            <div className="stats-grid">
              <div className="stat"><div className="stat-label">Bills</div><div className="stat-value">{Number(s.count)}</div></div>
              <div className="stat"><div className="stat-label">Taxable</div><div className="stat-value">{inr(s.taxable)}</div></div>
              <div className="stat"><div className="stat-label">Discounts</div><div className="stat-value accent-red">−{inr(s.discounts)}</div></div>
              <div className="stat"><div className="stat-label">GST</div><div className="stat-value">{inr(totalGst)}</div></div>
              <div className="stat"><div className="stat-label">Round-off</div><div className="stat-value">{inr(s.round_off)}</div></div>
              <div className="stat highlight"><div className="stat-label">Gross Collected</div><div className="stat-value">{inr(s.grand)}</div></div>
              <div className="stat"><div className="stat-label">Net Cash</div><div className="stat-value">{inr(data.netCash)}</div></div>
            </div>

            <div className="card-title mt">GST Break-up</div>
            <table>
              <thead>
                <tr><th>Component</th><th className="right">Amount</th></tr>
              </thead>
              <tbody>
                {[['CGST', s.cgst], ['SGST', s.sgst], ['UTGST', s.utgst], ['IGST', s.igst], ['Cess', s.cess]].map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td className="right">{inr(v)}</td></tr>
                ))}
              </tbody>
            </table>

            <div className="card-title mt">Payment Mode Mix</div>
            {data.modeMix.length === 0 ? (
              <div className="empty">No payments recorded for this day.</div>
            ) : (
              <table>
                <thead><tr><th>Mode</th><th className="right">Bills</th><th className="right">Total</th></tr></thead>
                <tbody>
                  {data.modeMix.map((m) => (
                    <tr key={m.mode}><td>{MODE_LABEL[m.mode] || m.mode}</td><td className="right">{Number(m.count)}</td><td className="right">{inr(m.total)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            {Number(data.returns.count) > 0 && (
              <>
                <div className="card-title mt">Returns & Refunds</div>
                <table>
                  <tbody>
                    <tr><td>Returns recorded</td><td className="right">{Number(data.returns.count)}</td></tr>
                    <tr><td>Returned value</td><td className="right">−{inr(data.returns.value)}</td></tr>
                    <tr><td>Refunded out</td><td className="right">−{inr(data.returns.refunded)}</td></tr>
                  </tbody>
                </table>
                {data.refundMix.length > 0 && (
                  <table>
                    <thead><tr><th>Refund Mode</th><th className="right">Payments</th><th className="right">Amount</th></tr></thead>
                    <tbody>
                      {data.refundMix.map((m) => (
                        <tr key={m.mode}><td>{MODE_LABEL[m.mode] || m.mode}</td><td className="right">{Number(m.count)}</td><td className="right">−{inr(m.total)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div className="card-title mt">Top Selling Items</div>
            {data.topItems.length === 0 ? (
              <div className="empty">No sales recorded for this day.</div>
            ) : (
              <table>
                <thead>
                  <tr><th>Item</th><th>HSN</th><th>GST%</th><th className="right">Qty</th><th className="right">Value</th></tr>
                </thead>
                <tbody>
                  {data.topItems.map((it, idx) => (
                    <tr key={idx}>
                      <td>{it.item_name}</td>
                      <td>{it.hsn_code}</td>
                      <td>{it.gst_rate}%</td>
                      <td className="right">{Number(it.qty)}</td>
                      <td className="right">{inr(it.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="card-title mt">Invoice Type Break-up</div>
            <table>
              <thead><tr><th>Type</th><th className="right">State</th><th className="right">Bills</th><th className="right">Taxable</th><th className="right">GST</th><th className="right">Total</th></tr></thead>
              <tbody>
                {data.byType.map((t, idx) => (
                  <tr key={idx}>
                    <td>{t.invoice_type}</td>
                    <td className="right">{t.is_interstate ? 'Inter' : 'Intra'}</td>
                    <td className="right">{Number(t.count)}</td>
                    <td className="right">{inr(t.taxable ?? t.tax ?? 0)}</td>
                    <td className="right">{inr(t.tax)}</td>
                    <td className="right">{inr(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}