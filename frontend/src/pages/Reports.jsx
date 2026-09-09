import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const firstOfMonth = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const today = () => new Date().toISOString().slice(0, 10);

const downloadReport = (path) => {
  const token = localStorage.getItem('triveni_token');
  fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => {
      if (!r.ok) throw new Error('Download failed');
      return r.blob();
    })
    .then((blob) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = path.split('?')[0].split('/').filter(Boolean).pop() + '-' + today() + (path.includes('xml') ? '.xml' : '.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    })
    .catch((e) => alert(e.message));
};

const SummaryRow = ({ label, value, total }) => (
  <div className="field" style={{ display: 'flex', justifyContent: 'space-between' }}>
    <span>{label}</span>
    <strong>{total ?? inr(value)}</strong>
  </div>
);

export default function Reports() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState(null);
  const [gstr1, setGstr1] = useState(null);
  const [gstr3b, setGstr3b] = useState([]);
  const [error, setError] = useState('');

  const load = () => {
    setSales(null);
    api
      .get(`/reports/sales?from=${from}&to=${to}`)
      .then(setSales)
      .catch((e) => setError(e.message));
    api
      .get(`/reports/gstr1?from=${from}&to=${to}`)
      .then(setGstr1)
      .catch(() => {});
    api
      .get(`/reports/gstr3b?from=${from}&to=${to}`)
      .then(setGstr3b)
      .catch(() => {});
  };

  useEffect(load, []);

  const s = sales?.summary || {};

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-title">
          <div className="row">
            <div className="field">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <button className="btn btn-primary" onClick={load}>Load Reports</button>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Sales Summary</div>
          {sales ? (
            <>
              <SummaryRow label="Invoices" value={s.invoice_count} />
              <SummaryRow label="Taxable Value" value={s.taxable_value} />
              <SummaryRow label="Discounts" value={s.discounts} />
              <SummaryRow label="CGST" value={s.cgst} />
              <SummaryRow label="SGST" value={s.sgst} />
              <SummaryRow label="IGST" value={s.igst} />
              <SummaryRow label="Cess" value={s.cess} />
              <SummaryRow label="Total Tax" value={s.tax} />
              <SummaryRow label="Grand Total" value={s.grand_total} total={true} />
              {sales.byDay?.length > 0 && (
                <table className="mt">
                  <thead><tr><th>Date</th><th className="right">Invoices</th><th className="right">Total</th></tr></thead>
                  <tbody>
                    {sales.byDay.map((d) => (
                      <tr key={d.invoice_date}>
                        <td className="nowrap">{d.invoice_date}</td>
                        <td className="right">{d.invoices}</td>
                        <td className="right nowrap">{inr(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <div className="empty">Loading…</div>
          )}
        </div>

        <div className="card">
          <div className="card-title">GSTR-3B (Rate-wise)</div>
          {gstr3b.length === 0 ? (
            <div className="empty">No data.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>GST %</th>
                  <th className="right">Taxable Value</th>
                  <th className="right">CGST</th>
                  <th className="right">SGST</th>
                  <th className="right">IGST</th>
                  <th className="right">Cess</th>
                </tr>
              </thead>
              <tbody>
                {gstr3b.map((r, i) => (
                  <tr key={i}>
                    <td>{r.gst_rate}%</td>
                    <td className="right nowrap">{inr(r.taxable_value)}</td>
                    <td className="right nowrap">{inr(r.cgst)}</td>
                    <td className="right nowrap">{inr(r.sgst)}</td>
                    <td className="right nowrap">{inr(r.igst)}</td>
                    <td className="right nowrap">{inr(r.cess)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">GSTR-1 (Outward Supplies)</div>
        {!gstr1 ? (
          <div className="empty">Loading…</div>
        ) : gstr1.data?.length === 0 ? (
          <div className="empty">No outward supplies.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice No</th>
                <th>Date</th>
                <th>POS</th>
                <th>HSN</th>
                <th>GST %</th>
                <th className="right">Qty</th>
                <th className="right">Taxable</th>
                <th className="right">CGST</th>
                <th className="right">SGST</th>
                <th className="right">IGST</th>
                <th className="right">Cess</th>
                <th>Customer</th>
                <th>GSTIN</th>
              </tr>
            </thead>
            <tbody>
              {gstr1.data.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{r.invoice_number}</td>
                  <td className="nowrap">{r.invoice_date}</td>
                  <td>{r.is_interstate ? 'IGST' : 'Same'}</td>
                  <td>{r.hsn_code}</td>
                  <td>{r.gst_rate}%</td>
                  <td className="right">{r.quantity}</td>
                  <td className="right nowrap">{inr(r.taxable_value)}</td>
                  <td className="right nowrap">{inr(r.cgst)}</td>
                  <td className="right nowrap">{inr(r.sgst)}</td>
                  <td className="right nowrap">{inr(r.igst)}</td>
                  <td className="right nowrap">{inr(r.cess)}</td>
                  <td>{r.customer_name}</td>
                  <td className="nowrap">{r.customer_gstin || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="6" className="right"><strong>Totals</strong></td>
                <td className="right nowrap"><strong>{inr(gstr1.totals?.taxable)}</strong></td>
                <td className="right nowrap"><strong>{inr(gstr1.totals?.cgst)}</strong></td>
                <td className="right nowrap"><strong>{inr(gstr1.totals?.sgst)}</strong></td>
                <td className="right nowrap"><strong>{inr(gstr1.totals?.igst)}</strong></td>
                <td className="right nowrap"><strong>{inr(gstr1.totals?.cess)}</strong></td>
                <td colSpan="2" />
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Exports</div>
        <p className="muted">Download the period's data for your accounting software.</p>
        <div className="flex">
          <button className="btn btn-primary" onClick={() => downloadReport(`/reports/export/csv?from=${from}&to=${to}`)}>Download CSV (Zoho/Busy/Excel)</button>
          <button className="btn" onClick={() => downloadReport(`/reports/export/xml?from=${from}&to=${to}`)}>Download Tally XML</button>
        </div>
      </div>
    </>
  );
}