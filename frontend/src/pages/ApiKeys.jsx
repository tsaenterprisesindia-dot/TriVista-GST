import { useEffect, useState } from 'react';
import { api } from '../api/client';

const ENDPOINTS = [
  { method: 'GET', path: '/api/v1/products', desc: 'List products' },
  { method: 'GET', path: '/api/v1/invoices', desc: 'List invoices' },
  { method: 'GET', path: '/api/v1/stock', desc: 'Current stock levels' },
  { method: 'GET', path: '/api/v1/gst-summary', desc: 'GST summary' },
];

export default function ApiKeys() {
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ client_name: '', scopes: 'read' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = () => {
    api.get('/apikeys/clients').then((d) => setClients(d.data || d || [])).catch(() => {});
  };

  useEffect(load, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      const d = await api.post('/apikeys/clients', form);
      setCreated(d);
      setSaved('API key created.');
      setForm({ client_name: '', scopes: 'read' });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const revoke = async (c) => {
    if (!window.confirm(`Revoke API key for "${c.client_name}"?`)) return;
    try {
      await api.post(`/apikeys/clients/${c.id}/revoke`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const showKey = created?.api_key || created?.key;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">Create API Key</div>
        <form onSubmit={create}>
          <div className="grid-2">
            <div className="field">
              <label>Client Name</label>
              <input value={form.client_name} onChange={set('client_name')} required />
            </div>
            <div className="field">
              <label>Scopes</label>
              <input value={form.scopes} onChange={set('scopes')} placeholder="read" />
            </div>
          </div>
          <button className="btn btn-primary" type="submit">Create API Key</button>
        </form>

        {showKey && (
          <div className="success-banner mt">
            <strong>Generated API key — copy it now, it is shown only once:</strong>
            <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
              {showKey}
            </pre>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">API Clients</div>
        {clients.length === 0 ? (
          <div className="empty">No API clients yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Client Name</th>
                <th>Scopes</th>
                <th>Active</th>
                <th>Last Used</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <td>{c.client_name}</td>
                  <td className="nowrap">{c.scopes}</td>
                  <td>
                    {c.is_active ? <span className="badge badge-green">ACTIVE</span> : <span className="badge badge-red">REVOKED</span>}
                  </td>
                  <td className="nowrap">{c.last_used_at || '—'}</td>
                  <td className="nowrap">{c.created_at}</td>
                  <td className="nowrap">
                    {c.is_active && (
                      <button className="btn btn-sm btn-danger" onClick={() => revoke(c)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Public Endpoints</div>
        <p className="muted">Authenticate with header <code>x-api-key</code>.</p>
        <table>
          <thead><tr><th>Method</th><th>Path</th><th>Description</th></tr></thead>
          <tbody>
            {ENDPOINTS.map((ep) => (
              <tr key={ep.path}>
                <td><span className="badge badge-blue">{ep.method}</span></td>
                <td className="nowrap">{ep.path}</td>
                <td>{ep.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}