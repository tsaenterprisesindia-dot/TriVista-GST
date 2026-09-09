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

const csvExport = (filename, headers, rows) => {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
};

const printReport = (title, headHtml, bodyHtml) => {
  const w = window.open('', '_blank', 'width=1000,height=700');
  if (!w) { alert('Please allow pop-ups to print.'); return; }
  w.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#1c2333;padding:24px;font-size:13px}
    h2{margin:0 0 4px} .muted{color:#67728a;font-size:12px;margin-bottom:14px}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#f4f6fb;text-align:left;padding:7px 9px;border:1px solid #dbe1ec}
    td{padding:6px 9px;border:1px solid #dbe1ec} td.r,th.r{text-align:right}
    tfoot td{font-weight:600;background:#f4f6fb}
  </style></head><body>${titleHtml(title)}<table><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 250);
};

const titleHtml = (title) => `<h2>${title}</h2><div class="muted">TriVista GST · A Unit of TSA Enterprises · ${today()}</div>`;

const num = (v) => (Number(v) || 0) === 0 ? '' : inr(v);

export default function Reports() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState(null);
  const [gstr1, setGstr1] = useState(null);
  const [gstr3b, setGstr3b] = useState([]);
  const [tb, setTb] = useState(null);
  const [aging, setAging] = useState(null);
  const [agingType, setAgingType] = useState('receivable');
  const [error, setError] = useState('');

  const loadAging = () => {
    setAging(null);
    api.get(`/reports/aging?type=${agingType}&asof=${to}`).then(setAging).catch((e) => setError(e.message));
  };

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
    api
      .get(`/reports/trial-balance?from=${from}&to=${to}`)
      .then(setTb)
      .catch(() => {});
    loadAging();
  };

  useEffect(load, []);
  useEffect(loadAging, [agingType]);

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
        <div className="card-title">
          <span>
            Trial Balance <span className="badge" style={{ marginLeft: 8 }}>{tb ? (tb.balanced ? 'Balanced' : 'Not balanced') : '…'}</span>
          </span>
          <div className="flex">
            <button
              className="btn btn-sm"
              disabled={!tb}
              onClick={() =>
                csvExport(
                  `trial-balance-${from}-to-${to}.csv`,
                  ['Account', 'Type', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'],
                  tb?.rows.map((r) => [r.name, r.type, r.o_dr, r.o_cr, r.d, r.c, r.c_dr, r.c_cr])
                )
              }
            >
              CSV (Excel)
            </button>
            <button
              className="btn btn-sm"
              disabled={!tb}
              onClick={() =>
                printReport(
                  `Trial Balance (${from} to ${to})`,
                  '<tr><th>Account</th><th>Type</th><th class="r">Opening Dr</th><th class="r">Opening Cr</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Closing Dr</th><th class="r">Closing Cr</th></tr>',
                  tb?.rows.map((r) => `<tr><td>${r.name}</td><td>${r.type}</td><td class="r">${r.o_dr || ''}</td><td class="r">${r.o_cr || ''}</td><td class="r">${r.d || ''}</td><td class="r">${r.c || ''}</td><td class="r">${r.c_dr || ''}</td><td class="r">${r.c_cr || ''}</td></tr>`).join('') +
                    `<tfoot><tr><td colspan="2">Totals</td><td class="r">${tb?.totals.openDr}</td><td class="r">${tb?.totals.openCr}</td><td class="r">${tb?.totals.debit}</td><td class="r">${tb?.totals.credit}</td><td class="r">${tb?.totals.closeDr}</td><td class="r">${tb?.totals.closeCr}</td></tr></tfoot>`
                )
              }
            >
              Print / PDF
            </button>
          </div>
        </div>
        {!tb ? (
          <div className="empty">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Type</th>
                <th className="right">Opening Dr</th>
                <th className="right">Opening Cr</th>
                <th className="right">Debit</th>
                <th className="right">Credit</th>
                <th className="right">Closing Dr</th>
                <th className="right">Closing Cr</th>
              </tr>
            </thead>
            <tbody>
              {tb.rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.type}</td>
                  <td className="right nowrap">{num(r.o_dr)}</td>
                  <td className="right nowrap">{num(r.o_cr)}</td>
                  <td className="right nowrap">{num(r.d)}</td>
                  <td className="right nowrap">{num(r.c)}</td>
                  <td className="right nowrap">{num(r.c_dr)}</td>
                  <td className="right nowrap">{num(r.c_cr)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan="2"><strong>Totals</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.openDr)}</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.openCr)}</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.debit)}</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.credit)}</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.closeDr)}</strong></td>
                <td className="right nowrap"><strong>{inr(tb.totals.closeCr)}</strong></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>Aging Analysis</span>
          <div className="flex">
            <button className={'btn btn-sm' + (agingType === 'receivable' ? ' btn-primary' : '')} onClick={() => setAgingType('receivable')}>
              Receivables
            </button>
            <button className={'btn btn-sm' + (agingType === 'payable' ? ' btn-primary' : '')} onClick={() => setAgingType('payable')}>
              Payables
            </button>
            <button
              className="btn btn-sm"
              disabled={!aging}
              onClick={() =>
                csvExport(
                  `aging-${agingType}-${to}.csv`,
                  ['Party', 'Documents', 'Billed', 'Paid', 'Due', 'Current', '31-60', '61-90', '90+'],
                  aging?.rows.map((r) => [r.name, r.count, r.billed, r.paid, r.due, r.current, r.d31_60, r.d61_90, r.d90p])
                )
              }
            >
              CSV (Excel)
            </button>
            <button
              className="btn btn-sm"
              disabled={!aging}
              onClick={() =>
                printReport(
                  `${agingType === 'receivable' ? 'Receivables' : 'Payables'} Aging (as of ${to})`,
                  '<tr><th>Party</th><th class="r">Documents</th><th class="r">Billed</th><th class="r">Paid</th><th class="r">Due</th><th class="r">Current</th><th class="r">31-60</th><th class="r">61-90</th><th class="r">90+</th></tr>',
                  aging?.rows.map((r) => `<tr><td>${r.name}</td><td class="r">${r.count}</td><td class="r">${r.billed}</td><td class="r">${r.paid}</td><td class="r">${r.due}</td><td class="r">${r.current}</td><td class="r">${r.d31_60}</td><td class="r">${r.d61_90}</td><td class="r">${r.d90p}</td></tr>`).join('') +
                    `<tfoot><tr><td>Totals</td><td class="r">${aging?.totals.count}</td><td class="r">${aging?.totals.billed}</td><td class="r">${aging?.totals.paid}</td><td class="r">${aging?.totals.due}</td><td class="r">${aging?.totals.current}</td><td class="r">${aging?.totals.d31_60}</td><td class="r">${aging?.totals.d61_90}</td><td class="r">${aging?.totals.d90p}</td></tr></tfoot>`
                )
              }
            >
              Print / PDF
            </button>
          </div>
        </div>
        {!aging ? (
          <div className="empty">Loading…</div>
        ) : aging.rows.length === 0 ? (
          <div className="empty">No outstanding {agingType === 'receivable' ? 'receivables' : 'payables'}.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Party</th>
                <th className="right">Documents</th>
                <th className="right">Billed</th>
                <th className="right">Paid</th>
                <th className="right">Due</th>
                <th className="right">Current (0–30)</th>
                <th className="right">31–60</th>
                <th className="right">61–90</th>
                <th className="right">90+</th>
              </tr>
            </thead>
            <tbody>
              {aging.rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.name}
                    <div className="muted" style={{ fontSize: 11 }}>{r.docs.map((d) => `${d.number} (${inr(d.due)})`).join(' · ')}</div>
                  </td>
                  <td className="right">{r.count}</td>
                  <td className="right nowrap">{inr(r.billed)}</td>
                  <td className="right nowrap">{inr(r.paid)}</td>
                  <td className="right nowrap"><strong>{inr(r.due)}</strong></td>
                  <td className="right nowrap">{inr(r.current)}</td>
                  <td className="right nowrap">{inr(r.d31_60)}</td>
                  <td className="right nowrap">{inr(r.d61_90)}</td>
                  <td className="right nowrap">{inr(r.d90p)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><strong>Totals</strong></td>
                <td className="right">{aging.totals.count}</td>
                <td className="right nowrap"><strong>{inr(aging.totals.billed)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.paid)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.due)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.current)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.d31_60)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.d61_90)}</strong></td>
                <td className="right nowrap"><strong>{inr(aging.totals.d90p)}</strong></td>
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