import { useEffect, useState } from 'react';
import { api } from '../api/client';

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true);
    const p = new URLSearchParams({ limit: '200' });
    if (q) p.set('q', q);
    if (entity) p.set('entity', entity);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    api
      .get(`/audit?${p.toString()}`)
      .then((d) => {
        setRows(d.data || []);
        setTotal(d.total || 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [q, entity, from, to]);

  const detail = (d) =>
    d && typeof d === 'object' ? JSON.stringify(d) : d || '';

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <div className="card-title">Audit Trail</div>
        <div className="grid-3">
          <div className="field">
            <label>Search (user, detail)</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. invoice no, party…" />
          </div>
          <div className="field">
            <label>Entity</label>
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">All entities</option>
              {['invoice', 'purchase_bill', 'product', 'customer', 'vendor', 'payment', 'user', 'authentication', 'stock', 'company', 'category', 'einvoice_log'].map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </div>
          <div className="grid-2" style={{ gridColumn: '1 / -1' }}>
            <div className="field">
              <label>From</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>To</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          Entries{!loading && <> ({total})</>}
        </div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No audit entries match.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>ID</th>
                  <th>IP</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{new Date(r.created_at).toLocaleString()}</td>
                    <td className="nowrap">{r.user_name || '—'}</td>
                    <td>
                      <span className={`badge ${r.action.includes('FAIL') ? 'badge-red' : r.action.startsWith('DELETE') || r.action.startsWith('CANCEL') ? 'badge-amber' : 'badge-blue'}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="nowrap">{r.entity}</td>
                    <td>{r.entity_id ?? '—'}</td>
                    <td className="nowrap">{r.ip || '—'}</td>
                    <td style={{ maxWidth: 380, fontSize: 12 }}>{detail(r.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}