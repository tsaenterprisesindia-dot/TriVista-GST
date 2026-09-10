import { useRef, useState } from 'react';
import { api } from '../api/client';

const COLS = {
  customers: 'name, company_name, gstin, pan, phone, email, address_line1, address_line2, city, state, state_code, pincode, opening_balance, credit_limit, is_active',
  vendors: 'name, company_name, gstin, pan, phone, email, address_line1, city, state, state_code, pincode, opening_balance',
  products: 'name, sku, barcode, description, category_name, hsn_code, gst_rate, unit, selling_price, wholesale_price, purchase_price, mrp, min_stock, opening_stock, is_service',
  hsn: 'code, description, type, gst_rate',
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

export default function ImportCsv({ kind }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError('');
    setResult(null);
    setBusy(true);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) throw new Error('CSV must contain a header row followed by data rows.');
      const header = parsed[0].map((h) => String(h).trim().toLowerCase());
      const rows = parsed.slice(1).map((cells) => {
        const obj = {};
        header.forEach((h, i) => {
          obj[h] = cells[i] === undefined ? '' : cells[i].trim();
        });
        for (const k of Object.keys(obj)) {
          if (['yes', 'y', 'true', '1'].includes(String(obj[k]).toLowerCase())) obj[k] = true;
          else if (['no', 'n', 'false', '0', ''].includes(String(obj[k]).toLowerCase())) {
            if (String(obj[k]).toLowerCase() === '') obj[k] = '';
            else obj[k] = false;
          }
        }
        return obj;
      });
      const d = await api.post('/import/bulk', { kind, rows });
      setResult(d);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6, wordBreak: 'break-word' }}>
        Expected CSV columns: <code>{COLS[kind]}</code>
      </div>
      <div className="flex" style={{ gap: 8, alignItems: 'center' }}>
        <input type="file" accept=".csv,text/csv" ref={fileRef} onChange={onFile} disabled={busy} />
        {busy && <span className="muted">Importing…</span>}
      </div>
      {error && <div className="error-banner" style={{ marginTop: 8 }}>{error}</div>}
      {result && (
        <div style={{ marginTop: 8 }}>
          <div className="success-banner">
            {result.imported} of {result.total} rows imported.
          </div>
          {result.failed?.length > 0 && (
            <table style={{ marginTop: 8, fontSize: 12 }}>
              <thead>
                <tr><th>Row</th><th>Error</th></tr>
              </thead>
              <tbody>
                {result.failed.slice(0, 10).map((f, i) => (
                  <tr key={i}><td>{f.row}</td><td>{f.error}</td></tr>
                ))}
                {result.failed.length > 10 && (
                  <tr><td>…</td><td>{result.failed.length - 10} more row(s) failed.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}