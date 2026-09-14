import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

export default function TaxRates() {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [options, setOptions] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    effective_from: new Date().toISOString().slice(0, 10),
    gst_rate: '',
    cess_rate: '',
    source: '',
    notes: '',
  });
  const searched = useRef(false);

  const onChangeCode = (e) => {
    const v = e.target.value;
    setCode(v);
    searched.current = false;
    if (v.trim().length >= 2) {
      api.get(`/hsn?q=${encodeURIComponent(v.trim())}`).then(setOptions).catch(() => {});
    } else {
      setOptions([]);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const loadDetail = (c) => {
    setError('');
    setMsg('');
    setLoading(true);
    api
      .get(`/hsn/${encodeURIComponent(c)}/rates`)
      .then((d) => setDetail(d))
      .catch((e) => {
        setDetail(null);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  };

  const lookup = (e) => {
    e.preventDefault();
    const c = code.trim();
    if (!c) return setError('Enter an HSN/SAC code.');
    searched.current = true;
    loadDetail(c);
  };

  const pick = (h) => {
    setCode(h.code);
    searched.current = true;
    setForm((f) => ({ ...f, gst_rate: String(h.gst_rate), cess_rate: h.cess_rate ? String(h.cess_rate) : '' }));
    loadDetail(h.code);
  };

  useEffect(() => {
    if (detail) {
      setForm((f) => ({
        ...f,
        gst_rate: String(detail.current?.gst_rate ?? f.gst_rate),
        cess_rate: detail.current?.cess_rate ? String(detail.current.cess_rate) : f.cess_rate,
      }));
    }
  }, [detail]);

  const submitChange = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      await api.post('/hsn/rates', {
        code: code.trim(),
        effective_from: form.effective_from,
        gst_rate: Number(form.gst_rate),
        cess_rate: form.cess_rate === '' ? undefined : Number(form.cess_rate),
        source: form.source.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setMsg('Rate change recorded. New invoices use it from the effective date.');
      loadDetail(code.trim());
    } catch (err) {
      setError(err.message);
    }
  };

  const canChange = !['VIEWER'].includes(user?.role || '');

  return (
    <div className="card">
      <div className="card-title">GST Rates (HSN/SAC)</div>
      <div className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
        Statutory rates are stored with effective dates — never hard-coded. Invoice and purchase lines
        resolve the rate in force on their document date and snapshot it, so changing a rate never
        rewrites past bills.
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <form onSubmit={lookup} className="row">
        <div className="field grow">
          <label>HSN / SAC code</label>
          <input
            list="hsn-list"
            value={code}
            onChange={onChangeCode}
            placeholder="e.g. 62158300 or 996511"
          />
          <datalist id="hsn-list">
            {options.map((h) => (
              <option key={h.code} value={h.code}>
                {h.code} · {h.description || ''} · {h.gst_rate}%
              </option>
            ))}
          </datalist>
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <button className="btn btn-primary" type="submit">View Timeline</button>
        </div>
      </form>

      {!detail && (
        <div className="muted" style={{ marginTop: 8, fontSize: 12.5 }}>
          Pick a code from the suggestions or press View Timeline to load its rate history.
        </div>
      )}

      {loading && <div className="muted" style={{ marginTop: 12 }}>Loading…</div>}

      {detail && (
        <>
          <div className="row" style={{ marginTop: 6 }}>
            <div className="field">
              <label>Description</label>
              <div>{detail.description || '—'}</div>
            </div>
            <div className="field">
              <label>Type</label>
              <div>{detail.type}</div>
            </div>
            <div className="field">
              <label>Current GST rate</label>
              <div>
                <strong>{detail.current?.gst_rate}%</strong>
                <span className="muted"> (CGST {Number(detail.current?.cgst_rate || 0)}% + SGST {Number(detail.current?.sgst_rate || 0)}%)</span>
              </div>
            </div>
            <div className="field">
              <label>Current cess</label>
              <div>{Number(detail.current?.cess_rate || 0) ? `${detail.current.cess_rate}%` : '—'}</div>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Effective From</th>
                <th>Effective To</th>
                <th>GST %</th>
                <th>Cess %</th>
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {(detail.history || []).map((h) => (
                <tr key={h.id}>
                  <td>{fmtDate(h.effective_from)}</td>
                  <td>{h.effective_to ? fmtDate(h.effective_to) : 'in force'}</td>
                  <td>{h.gst_rate}%</td>
                  <td>{h.cess_rate ? `${h.cess_rate}%` : '—'}</td>
                  <td className="muted">{h.source || '—'}</td>
                  <td className="muted">{h.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {canChange && (
            <form onSubmit={submitChange} className="row" style={{ marginTop: 18 }}>
              <div className="field">
                <label>New rate effective from</label>
                <input type="date" value={form.effective_from} onChange={set('effective_from')} required />
              </div>
              <div className="field">
                <label>New GST rate (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={form.gst_rate} onChange={set('gst_rate')} required />
              </div>
              <div className="field">
                <label>Cess rate (%)</label>
                <input type="number" min="0" max="100" step="0.01" value={form.cess_rate} onChange={set('cess_rate')} placeholder="Optional" />
              </div>
              <div className="field">
                <label>Notification / source</label>
                <input value={form.source} onChange={set('source')} placeholder="e.g. Notification 01/2025" />
              </div>
              <div className="field grow">
                <label>Notes</label>
                <input value={form.notes} onChange={set('notes')} placeholder="Why / what changed" />
              </div>
              <div className="field">
                <label>&nbsp;</label>
                <button className="btn btn-primary" type="submit">Schedule Change</button>
              </div>
            </form>
          )}
          <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Past invoices keep the rate snapped at their line level; this only governs invoices from
            the effective date onwards. Existing credit/stock data is untouched.
          </div>
        </>
      )}
    </div>
  );
}