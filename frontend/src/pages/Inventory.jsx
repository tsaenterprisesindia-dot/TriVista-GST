import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const typeBadge = (t) => {
  const map = {
    IN: <span className="badge badge-green">IN</span>,
    OUT: <span className="badge badge-red">OUT</span>,
    ADJUST: <span className="badge badge-amber">ADJUST</span>,
  };
  return map[t] || <span className="badge badge-gray">{t}</span>;
};

export default function Inventory() {
  const [tab, setTab] = useState('report');
  const [lowOnly, setLowOnly] = useState(false);
  const [report, setReport] = useState([]);
  const [movements, setMovements] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState({
    product_id: '',
    type: 'IN',
    quantity: '',
    unit_cost: '',
    note: '',
  });

  const loadReport = () => {
    setLoading(true);
    api
      .get(`/inventory/report?lowOnly=${lowOnly}`)
      .then(setReport)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadMovements = () => {
    api.get('/inventory/movements').then(setMovements).catch(() => {});
  };

  useEffect(loadReport, [lowOnly]);
  useEffect(() => {
    loadMovements();
    api.get('/inventory/stock').then(setStockItems).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const pickTab = (t) => {
    setTab(t);
    setLowOnly(t === 'low');
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.post('/inventory/movements', form);
      setShowForm(false);
      setForm({ product_id: '', type: 'IN', quantity: '', unit_cost: '', note: '' });
      setSaved('Stock movement recorded.');
      loadReport();
      loadMovements();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">
          <div className="flex">
            <button className={`btn btn-sm ${tab === 'report' ? 'btn-primary' : ''}`} onClick={() => pickTab('report')}>Stock Report</button>
            <button className={`btn btn-sm ${tab === 'low' ? 'btn-primary' : ''}`} onClick={() => pickTab('low')}>Low Stock</button>
            {tab === 'report' && (
              <label className="flex" style={{ fontSize: 13, marginLeft: 8 }}>
                <input
                  type="checkbox"
                  checked={lowOnly}
                  onChange={(e) => setLowOnly(e.target.checked)}
                  style={{ width: 'auto' }}
                />{' '}
                Low stock only
              </label>
            )}
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>+ Add Stock</button>
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Product</label>
                <select value={form.product_id} onChange={set('product_id')} required>
                  <option value="">— Select —</option>
                  {stockItems.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.sku})</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Type</label>
                <select value={form.type} onChange={set('type')}>
                  <option value="IN">IN — Stock In</option>
                  <option value="OUT">OUT — Stock Out</option>
                  <option value="ADJUST">ADJUST — Adjustment</option>
                </select>
              </div>
              <div className="field">
                <label>Quantity</label>
                <input value={form.quantity} onChange={set('quantity')} type="number" required />
              </div>
              <div className="field">
                <label>Unit Cost</label>
                <input value={form.unit_cost} onChange={set('unit_cost')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Note</label>
                <input value={form.note} onChange={set('note')} />
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">Save</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? (
          <div>Loading…</div>
        ) : report.length === 0 ? (
          <div className="empty">No stock data.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th className="right">Stock On Hand</th>
                <th className="right">Avg Cost</th>
                <th className="right">Min Level</th>
                <th className="right">Stock Value</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{r.sku}</td>
                  <td>{r.name}</td>
                  <td className="right">
                    {Number(r.stock_on_hand) <= Number(r.min_stock) ? (
                      <span className="badge badge-red">{r.stock_on_hand}</span>
                    ) : (
                      r.stock_on_hand
                    )}
                  </td>
                  <td className="right nowrap">{inr(r.avg_cost)}</td>
                  <td className="right">{r.min_stock}</td>
                  <td className="right nowrap">{inr(r.stock_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Stock Movements</div>
        {movements.length === 0 ? (
          <div className="empty">No movements recorded.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Type</th>
                <th>Product</th>
                <th className="right">Qty</th>
                <th className="right">Unit Cost</th>
                <th>Note</th>
                <th>By</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{typeBadge(m.type)}</td>
                  <td>{m.product_name}</td>
                  <td className="right">{m.quantity}</td>
                  <td className="right nowrap">{inr(m.unit_cost)}</td>
                  <td className="muted">{m.note || '—'}</td>
                  <td>{m.created_by_name || '—'}</td>
                  <td className="nowrap">{m.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}