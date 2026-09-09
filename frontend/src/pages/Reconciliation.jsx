import { Fragment, useState, useEffect } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const statusBadge = (s) => {
  const map = {
    MATCHED: <span className="badge badge-green">MATCHED</span>,
    MISMATCH: <span className="badge badge-amber">MISMATCH</span>,
    NOT_FOUND: <span className="badge badge-red">NOT_FOUND</span>,
  };
  return map[s] || <span className="badge badge-gray">{s}</span>;
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function Reconciliation() {
  const [period, setPeriod] = useState(thisMonth);
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState(null);
  const [imports, setImports] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = () => {
    api.get('/reconciliation').then((d) => setImports(d.data || d || [])).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const parseAndRun = async () => {
    setError('');
    setResult(null);
    try {
      const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean);
      const rows = lines.map((l) => {
        const [gstin, supplier_name, invoice_no, invoice_date, taxable_value, gst_amount] = l.split(',').map((c) => c.trim());
        return { gstin, supplier_name, invoice_no, invoice_date, taxable_value, gst_amount };
      });
      if (rows.length === 0) return;
      const d = await api.post('/reconciliation/import', { period, rows });
      setResult(d);
      setSaved('Import completed.');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const view = async (id) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    try {
      const d = await api.get(`/reconciliation/${id}`);
      setDetail(d);
    } catch (e) {
      setError(e.message);
    }
  };

  const rows = detail?.rows || detail?.data || [];
  const summaryArr = detail?.summary || [];
  const by = (s) => summaryArr.find((x) => x.status === s);
  const summary = summaryArr.length
    ? {
        total: summaryArr.reduce((t, s) => t + Number(s.n || 0), 0),
        matched: Number(by('MATCHED')?.n || 0),
        matched_taxable: Number(by('MATCHED')?.taxable || 0),
        mismatched: Number(by('MISMATCH')?.n || 0),
        mismatched_taxable: Number(by('MISMATCH')?.taxable || 0),
        not_found: Number(by('NOT_FOUND')?.n || 0),
        not_found_taxable: Number(by('NOT_FOUND')?.taxable || 0),
      }
    : null;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">Import &amp; Match</div>
        <div className="field" style={{ maxWidth: 220 }}>
          <label>Period (YYYY-MM)</label>
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
        </div>
        <div className="field">
          <label>Paste CSV rows — gstin,supplier_name,invoice_no,invoice_date,taxable_value,gst_amount per line</label>
          <textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={'27AAACP1234F1Z5,Acme Traders,INV-001,2026-01-05,1000.00,180.00'} />
        </div>
        <button className="btn btn-primary" onClick={parseAndRun} disabled={!csv.trim()}>Parse &amp; Run</button>

        {result && (
          <div className="stats-grid mt">
            <div className="stat-card"><div className="label">Total Rows</div><div className="value">{result.total}</div></div>
            <div className="stat-card"><div className="label">Matched</div><div className="value" style={{ color: 'var(--green)' }}>{result.matched}</div></div>
            <div className="stat-card"><div className="label">Mismatched</div><div className="value" style={{ color: 'var(--amber)' }}>{result.mismatched}</div></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Imports</div>
        {imports.length === 0 ? (
          <div className="empty">No imports yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <Fragment key={imp.id}>
                  <tr>
                    <td className="nowrap">{imp.period || imp.month}</td>
                    <td>{statusBadge(imp.status || 'NOT_FOUND')}</td>
                    <td>
                      <button className="btn btn-sm" onClick={() => view(imp.id)}>{openId === imp.id ? 'Close' : 'View'}</button>
                    </td>
                  </tr>
                  {openId === imp.id && (
                    <tr key={`${imp.id}-detail`}>
                      <td colSpan={3}>
                        {detail ? (
                          <>
                            {summary && (
                              <div className="flex mb">
                                <span className="badge badge-gray">Total: {summary.total}</span>
                                <span className="badge badge-green">Matched: {summary.matched} · {inr(summary.matched_taxable)}</span>
                                <span className="badge badge-amber">Mismatch: {summary.mismatched} · {inr(summary.mismatched_taxable)}</span>
                                <span className="badge badge-red">Not Found: {summary.not_found} · {inr(summary.not_found_taxable)}</span>
                              </div>
                            )}
                            <table>
                              <thead>
                                <tr>
                                  <th>GSTIN</th>
                                  <th>Supplier</th>
                                  <th>Invoice No</th>
                                  <th>Date</th>
                                  <th className="right">Taxable</th>
                                  <th className="right">GST Amt</th>
                                  <th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r, i) => (
                                  <tr key={i}>
                                    <td className="nowrap">{r.supplier_gstin}</td>
                                    <td>{r.supplier_name}</td>
                                    <td className="nowrap">{r.invoice_no}</td>
                                    <td className="nowrap">{r.invoice_date}</td>
                                    <td className="right nowrap">{inr(r.taxable_value)}</td>
                                    <td className="right nowrap">{inr(r.gst_amount)}</td>
                                    <td>{statusBadge(r.status)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </>
                        ) : (
                          <div>Loading…</div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}