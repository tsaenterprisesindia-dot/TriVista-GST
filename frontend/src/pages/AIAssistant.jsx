import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const PROVIDERS = ['NONE', 'OPENAI', 'GEMINI', 'AZURE'];

export default function AIAssistant() {
  const [insights, setInsights] = useState(null);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [settings, setSettings] = useState({
    provider: 'NONE',
    model: '',
    endpoint: '',
    api_key: '',
    is_enabled: false,
  });

  useEffect(() => {
    api.get('/ai/insights').then(setInsights).catch((e) => setError(e.message));
    api.get('/ai/settings').then((d) => setSettings((s) => ({ ...s, ...d }))).catch(() => {});
  }, []);

  const ask = async (e) => {
    e.preventDefault();
    if (!message.trim() || busy) return;
    setBusy(true);
    setChat(null);
    try {
      const d = await api.post('/ai/chat', { message });
      setChat(d);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setSettings((s) => ({ ...s, [k]: v }));
  };

  const save = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      const body = { ...settings };
      await api.put('/ai/settings', body);
      setSaved('AI settings saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const sum = insights?.summary || {};
  const top = { name: sum.topProduct?.item_name || sum.topProduct?.name || '—', value: sum.topProduct?.val || sum.topProduct?.value || 0 };
  const suggestions = insights?.suggestions || [];

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Business Insights</div>
          {!insights ? (
            <div className="empty">Loading…</div>
          ) : (
            <>
              <div className="stats-grid">
                <div className="stat-card"><div className="label">Month Sales</div><div className="value">{inr(sum.monthSales)}</div></div>
                <div className="stat-card">
                  <div className="label">Growth</div>
                  <div className="value" style={{ color: Number(sum.growth) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {Number(sum.growth) >= 0 ? '▲' : '▼'} {Number(sum.growth).toFixed(1)}%
                  </div>
                </div>
                <div className="stat-card">
                  <div className="label">Top Product</div>
                  <div className="value" style={{ fontSize: 16 }}>{top.name || '—'}</div>
                  <div className="sub">{inr(top.value)}</div>
                </div>
              </div>
              {suggestions.length > 0 && (
                <>
                  <div className="card-title">Suggestions</div>
                  <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {suggestions.map((sg, i) => (
                      <li key={i} className="mb">{sg}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </div>

        <div className="card">
          <div className="card-title">Ask the Assistant</div>
          <form onSubmit={ask} className="flex">
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about sales, GST, stock…"
            />
            <button className="btn btn-primary" disabled={busy || !message.trim()}>{busy ? '…' : 'Send'}</button>
          </form>
          {chat && (
            <div className="mt">
              <div className="mb">
                {String(chat.mode || '').toUpperCase() === 'RULES' ? (
                  <span className="badge badge-green">RULES</span>
                ) : (
                  <span className="badge badge-blue">{chat.mode || 'AI'}</span>
                )}
              </div>
              <div style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 8 }}>
                {chat.answer || chat.response || JSON.stringify(chat)}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">AI Settings</div>
        <form onSubmit={save}>
          <div className="grid-3">
            <div className="field">
              <label>Provider</label>
              <select value={settings.provider} onChange={set('provider')}>
                {PROVIDERS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Model</label>
              <input value={settings.model} onChange={set('model')} placeholder="gpt-4o / gemini-pro…" />
            </div>
            <div className="field">
              <label>Endpoint</label>
              <input value={settings.endpoint} onChange={set('endpoint')} placeholder="https://…" />
            </div>
            <div className="field">
              <label>API Key</label>
              <input value={settings.api_key} onChange={set('api_key')} type="password" />
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={settings.is_enabled} onChange={set('is_enabled')} style={{ width: 'auto' }} />{' '}
                Enable AI
              </label>
            </div>
          </div>
          <button className="btn btn-primary" type="submit">Save AI Settings</button>
        </form>
      </div>
    </>
  );
}