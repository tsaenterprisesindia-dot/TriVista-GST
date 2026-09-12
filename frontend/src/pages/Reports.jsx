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
      const cd = r.headers.get('Content-Disposition');
      const m = cd && cd.match(/filename="?([^"]+)"?/);
      const name = m ? m[1] : path.split('?')[0].split('/').filter(Boolean).pop() + '-' + today() + (path.includes('xml') ? '.xml' : '.csv');
      return r.blob().then((b) => ({ b, name }));
    })
    .then(({ b, name }) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(b);
      link.download = name;
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
  const [gstr9, setGstr9] = useState(null);
  const [gstr9c, setGstr9c] = useState(null);
  const [itcReg, setItcReg] = useState(null);
  const [hsn, setHsn] = useState(null);
  const [tds, setTds] = useState(null);
  const [tcs, setTcs] = useState(null);
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
    api.get(`/reports/gstr9?from=${from}&to=${to}`).then(setGstr9).catch(() => {});
    api.get(`/reports/gstr9c?from=${from}&to=${to}`).then(setGstr9c).catch(() => {});
    api.get(`/reports/itc-register?from=${from}&to=${to}`).then(setItcReg).catch(() => {});
    api.get(`/reports/hsn-summary?from=${from}&to=${to}`).then(setHsn).catch(() => {});
    api.get(`/reports/tds-26q?from=${from}&to=${to}`).then(setTds).catch(() => {});
    api.get(`/reports/tcs-27eq?from=${from}&to=${to}`).then(setTcs).catch(() => {});
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
              {s.utgst > 0 && <SummaryRow label="UTGST" value={s.utgst} />}
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
                  <th className="right">UTGST</th>
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
                    <td className="right nowrap">{inr(r.utgst)}</td>
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
        <div className="card-title">GSTR-1 (Outward Supplies)
          <button
            className="btn btn-primary btn-sm" style={{ float: 'right' }}
            title="Download official GSTN upload JSON for this period"
            onClick={() => downloadReport(`/reports/gstr1-json?from=${from}&to=${to}`)}
          >
            Download GSTR-1 JSON (official upload)
          </button>
        </div>
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
                <th className="right">UTGST</th>
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
                  <td className="right nowrap">{inr(r.utgst)}</td>
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
                <td className="right nowrap"><strong>{inr(gstr1.totals?.utgst)}</strong></td>
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
        <div className="card-title">
          <span>GSTR-9 · Annual Return (FY {from} → {to})</span>
          <div className="flex">
            <button
              className="btn btn-sm"
              disabled={!gstr9}
              onClick={() =>
                csvExport(`gstr9-${from}-to-${to}.csv`, ['Rate%', 'Taxable', 'CGST', 'SGST', 'UTGST', 'IGST', 'Cess'],
                  gstr9?.outward.map((r) => [r.gst_rate, r.taxable_value, r.cgst, r.sgst, r.utgst, r.igst, r.cess]))
              }
            >
              CSV
            </button>
          </div>
        </div>
        {!gstr9 ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="grid-2">
            <div>
              <table className="mt">
                <thead><tr><th>Rate</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th><th className="right">UTGST</th><th className="right">IGST</th><th className="right">Cess</th></tr></thead>
                <tbody>
                  {gstr9.outward.map((r, i) => (
                    <tr key={i}><td>{r.gst_rate}%</td><td className="right nowrap">{inr(r.taxable_value)}</td><td className="right nowrap">{inr(r.cgst)}</td><td className="right nowrap">{inr(r.sgst)}</td><td className="right nowrap">{inr(r.utgst || 0)}</td><td className="right nowrap">{inr(r.igst)}</td><td className="right nowrap">{inr(r.cess)}</td></tr>
                  ))}
                  {gstr9.outward.length === 0 && <tr><td colSpan="7" className="empty">No outward supply.</td></tr>}
                </tbody>
                <tfoot>
                  <tr><td><strong>Total</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.taxable)}</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.cgst)}</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.sgst)}</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.utgst || 0)}</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.igst)}</strong></td><td className="right nowrap"><strong>{inr(gstr9.outward_totals?.cess)}</strong></td></tr>
                </tfoot>
              </table>
              <p className="muted" style={{ margin: '10px 0' }}>Turnover (books): <strong>{inr(gstr9.turnover)}</strong> · ITC booked: <strong>{inr(gstr9.itc_total)}</strong></p>
            </div>
            <div>
              <table className="mt">
                <thead><tr><th>RCM supplies (no vendor GSTIN)</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th><th className="right">UTGST</th><th className="right">IGST</th></tr></thead>
                <tbody>
                  {gstr9.rcm.map((r, i) => (
                    <tr key={i}><td>{r.gst_rate}%</td><td className="right nowrap">{inr(r.taxable_value)}</td><td className="right nowrap">{inr(r.cgst)}</td><td className="right nowrap">{inr(r.sgst)}</td><td className="right nowrap">{inr(r.utgst || 0)}</td><td className="right nowrap">{inr(r.igst)}</td></tr>
                  ))}
                  {gstr9.rcm.length === 0 && <tr><td colSpan="6" className="empty">No RCM.</td></tr>}
                </tbody>
              </table>
              <div className="summary-row">
                <SummaryRow label="Net GST payable (out − ITC)" value={gstr9.netGstPayable} />
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>GSTR-9C · Reconciliation (FY {from} → {to})</span>
          <div className="flex">
            <button
              className="btn btn-sm"
              disabled={!gstr9c}
              onClick={() =>
                csvExport(`gstr9c-${from}-to-${to}.csv`, ['Item', 'Value'],
                  Object.entries(gstr9c || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]))
              }
            >
              CSV
            </button>
          </div>
        </div>
        {!gstr9c ? (
          <div className="empty">Loading…</div>
        ) : (
          <div className="grid-3">
            <div className="summary-row">
              <SummaryRow label="Turnover as per books" value={gstr9c.turnover_as_per_books} />
              <SummaryRow label="Taxable as per books" value={gstr9c.taxable_as_per_books} />
              <SummaryRow label="GST as per books" value={gstr9c.gst_as_per_books} />
            </div>
            <div className="summary-row">
              <SummaryRow label="ITC as per books" value={gstr9c.itc_as_per_books} />
              <SummaryRow label="ITC claimed (Q7)" value={gstr9c.input_credit_claimed} />
              <SummaryRow label="ITC difference" value={gstr9c.itc_difference} />
            </div>
            <div className="summary-row">
              <SummaryRow label="Tax deposited (26Q/27EQ + GST PMT)" value={gstr9c.tax_deposited} />
              <SummaryRow label="Tax difference" value={gstr9c.tax_difference} />
              <SummaryRow label="CA variance" value={gstr9c.clearance?.variance} />
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>ITC Register</span>
          <div className="flex">
            <button
              className="btn btn-sm"
              disabled={!itcReg}
              onClick={() =>
                csvExport(`itc-register-${from}-to-${to}.csv`, ['Bill', 'Date', 'Vendor', 'GSTIN', 'Type', 'Taxable', 'CGST', 'SGST', 'UTGST', 'IGST', 'Total GST', 'Grand'],
                  itcReg?.data.map((r) => [r.bill_number, r.bill_date, r.vendor_name, r.vendor_gstin || '', r.eligible, r.taxable_value, r.cgst, r.sgst, r.utgst, r.igst, r.total_gst, r.grand_total]))
              }
            >
              CSV
            </button>
          </div>
        </div>
        {!itcReg ? (
          <div className="empty">Loading…</div>
        ) : (
          <>
            <table>
              <thead>
                <tr><th>Bill</th><th>Date</th><th>Vendor</th><th>GSTIN</th><th>Type</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th><th className="right">UTGST</th><th className="right">IGST</th><th className="right">Total GST</th></tr>
              </thead>
              <tbody>
                {itcReg.data.map((r, i) => (
                  <tr key={i}>
                    <td className="nowrap">{r.bill_number}</td>
                    <td className="nowrap">{r.bill_date}</td>
                    <td>{r.vendor_name}</td>
                    <td className="nowrap">{r.vendor_gstin || '—'}</td>
                    <td>{r.eligible === 'ELIGIBLE' ? <span className="badge badge-green">ELIGIBLE</span> : <span className="badge badge-red">INELIGIBLE (RCM)</span>}</td>
                    <td className="right nowrap">{inr(r.taxable_value)}</td>
                    <td className="right nowrap">{inr(r.cgst)}</td>
                    <td className="right nowrap">{inr(r.sgst)}</td>
                    <td className="right nowrap">{inr(r.utgst || 0)}</td>
                    <td className="right nowrap">{inr(r.igst)}</td>
                    <td className="right nowrap">{inr(r.total_gst)}</td>
                  </tr>
                ))}
                {itcReg.data.length === 0 && <tr><td colSpan="11" className="empty">No purchases in period.</td></tr>}
              </tbody>
            </table>
            <div className="summary-row" style={{ display: 'flex', gap: 24, marginTop: 10 }}>
              <span>Eligible ITC: <strong>{inr(itcReg.totals?.eligible)}</strong></span>
              <span>Ineligible (RCM): <strong>{inr(itcReg.totals?.ineligible)}</strong></span>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          <span>HSN Summary (GSTR-1 Tab 12)</span>
          <div className="flex">
            <button
              className="btn btn-sm"
              disabled={!hsn}
              onClick={() =>
                csvExport(`hsn-summary-${from}-to-${to}.csv`, ['HSN', 'Rate%', 'Unit', 'Qty', 'Txns', 'Taxable', 'CGST', 'SGST', 'UTGST', 'IGST', 'Cess'],
                  hsn?.data.map((r) => [r.hsn_code, r.gst_rate, r.unit, r.quantity, r.txns, r.taxable_value, r.cgst, r.sgst, r.utgst, r.igst, r.cess]))
              }
            >
              CSV
            </button>
          </div>
        </div>
        {!hsn ? (
          <div className="empty">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr><th>HSN</th><th>Rate %</th><th>Unit</th><th className="right">Qty</th><th className="right">Txns</th><th className="right">Taxable</th><th className="right">CGST</th><th className="right">SGST</th><th className="right">UTGST</th><th className="right">IGST</th><th className="right">Cess</th></tr>
            </thead>
            <tbody>
              {hsn.data.map((r, i) => (
                <tr key={i}>
                  <td className="nowrap">{r.hsn_code || '—'}</td>
                  <td>{r.gst_rate}%</td>
                  <td>{r.unit}</td>
                  <td className="right">{r.quantity}</td>
                  <td className="right">{r.txns}</td>
                  <td className="right nowrap">{inr(r.taxable_value)}</td>
                  <td className="right nowrap">{inr(r.cgst)}</td>
                  <td className="right nowrap">{inr(r.sgst)}</td>
                  <td className="right nowrap">{inr(r.utgst || 0)}</td>
                  <td className="right nowrap">{inr(r.igst)}</td>
                  <td className="right nowrap">{inr(r.cess)}</td>
                </tr>
              ))}
              {hsn.data.length === 0 && <tr><td colSpan="11" className="empty">No sales in period.</td></tr>}
            </tbody>
            <tfoot>
              <tr><td colSpan="3"><strong>Totals</strong></td><td className="right"><strong>{hsn.totals?.quantity}</strong></td><td /><td className="right nowrap"><strong>{inr(hsn.totals?.taxable_value)}</strong></td><td className="right nowrap"><strong>{inr(hsn.totals?.cgst)}</strong></td><td className="right nowrap"><strong>{inr(hsn.totals?.sgst)}</strong></td><td className="right nowrap"><strong>{inr(hsn.totals?.utgst || 0)}</strong></td><td className="right nowrap"><strong>{inr(hsn.totals?.igst)}</strong></td><td className="right nowrap"><strong>{inr(hsn.totals?.cess)}</strong></td></tr>
            </tfoot>
          </table>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">
            <span>Form 26Q · TDS (Sec 194Q)</span>
            <div className="flex">
              <button
                className="btn btn-sm"
                disabled={!tds}
                onClick={() =>
                  csvExport(`tds-26q-${from}-to-${to}.csv`, ['Bill', 'Date', 'Vendor', 'PAN', 'Grand Total', 'TDS'],
                    tds?.data.map((r) => [r.bill_number, r.bill_date, r.vendor_name, r.vendor_pan || '', r.grand_total, r.tds_amount]))
                }
              >
                CSV
              </button>
            </div>
          </div>
          {!tds ? (
            <div className="empty">Loading…</div>
          ) : tds.data.length === 0 ? (
            <div className="empty">No TDS in period (0.1% above threshold).</div>
          ) : (
            <table>
              <thead><tr><th>Bill</th><th>Date</th><th>Vendor</th><th>PAN</th><th className="right">Total</th><th className="right">TDS</th></tr></thead>
              <tbody>
                {tds.data.map((r, i) => (
                  <tr key={i}><td className="nowrap">{r.bill_number}</td><td className="nowrap">{r.bill_date}</td><td>{r.vendor_name}</td><td className="nowrap">{r.vendor_pan || '—'}</td><td className="right nowrap">{inr(r.grand_total)}</td><td className="right nowrap">{inr(r.tds_amount)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan="5" className="right"><strong>Total TDS</strong></td><td className="right nowrap"><strong>{inr(tds.total)}</strong></td></tr></tfoot>
            </table>
          )}
        </div>

        <div className="card">
          <div className="card-title">
            <span>Form 27EQ · TCS (Sec 206C(1H))</span>
            <div className="flex">
              <button
                className="btn btn-sm"
                disabled={!tcs}
                onClick={() =>
                  csvExport(`tcs-27eq-${from}-to-${to}.csv`, ['Invoice', 'Date', 'Customer', 'PAN', 'Grand Total', 'TCS'],
                    tcs?.data.map((r) => [r.invoice_number, r.invoice_date, r.customer_name, r.customer_pan || '', r.grand_total, r.tcs_amount]))
                }
              >
                CSV
              </button>
            </div>
          </div>
          {!tcs ? (
            <div className="empty">Loading…</div>
          ) : tcs.data.length === 0 ? (
            <div className="empty">No TCS in period (0.1% above threshold).</div>
          ) : (
            <table>
              <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>PAN</th><th className="right">Total</th><th className="right">TCS</th></tr></thead>
              <tbody>
                {tcs.data.map((r, i) => (
                  <tr key={i}><td className="nowrap">{r.invoice_number}</td><td className="nowrap">{r.invoice_date}</td><td>{r.customer_name}</td><td className="nowrap">{r.customer_pan || '—'}</td><td className="right nowrap">{inr(r.grand_total)}</td><td className="right nowrap">{inr(r.tcs_amount)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan="5" className="right"><strong>Total TCS</strong></td><td className="right nowrap"><strong>{inr(tcs.total)}</strong></td></tr></tfoot>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>CA Export Kit</span>
          <span className="muted" style={{ fontSize: 12 }}>Send this ZIP to your CA for the period — opens directly in Excel &amp; Tally</span>
        </div>
        <p className="muted">
          Contains: cover letter with period summary · sales &amp; purchase registers · item books · trial balance ·
          GSTR-1 annexure &amp; GSTR-3B workings · receivables/payables statements · Tally XML import file.
        </p>
        <div className="flex">
          <button className="btn btn-primary" onClick={() => downloadReport(`/reports/ca-export?from=${from}&to=${to}`)}>Download CA Package (ZIP)</button>
          <span className="muted">{from} to {to}</span>
        </div>
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