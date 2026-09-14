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

const todayStr = () => new Date().toISOString().slice(0, 10);
const daysUntil = (d) => Math.ceil((new Date(d) - new Date(todayStr())) / 86400000);

const listSerials = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);

export default function Inventory() {
  const [tab, setTab] = useState('report');
  const [lowOnly, setLowOnly] = useState(false);
  const [report, setReport] = useState([]);
  const [movements, setMovements] = useState([]);
  const [stockItems, setStockItems] = useState([]);
  const [batches, setBatches] = useState([]);
  const [serials, setSerials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saved, setSaved] = useState('');
  const [form, setForm] = useState({
    product_id: '',
    type: 'IN',
    quantity: '',
    unit_cost: '',
    batch_no: '',
    expiry_date: '',
    mfg_date: '',
    serial_numbers: '',
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

  const loadBatches = () => {
    api.get('/inventory/batches').then(setBatches).catch(() => {});
  };

  const loadSerials = () => {
    api.get('/inventory/serials').then(setSerials).catch(() => {});
  };

  const loadMovements = () => {
    api.get('/inventory/movements').then(setMovements).catch(() => {});
  };

  useEffect(loadReport, [lowOnly]);
  useEffect(() => {
    loadMovements();
    loadBatches();
    loadSerials();
    api.get('/products?limit=500').then((d) => setStockItems((d.data || []).filter((p) => !p.is_service))).catch(() => {});
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
    const body = { ...form };
    if (!body.batch_no && !body.expiry_date && !body.mfg_date && body.serial_numbers) {
      delete body.serial_numbers;
    }
    try {
      await api.post('/inventory/movements', body);
      setShowForm(false);
      setForm({ product_id: '', type: 'IN', quantity: '', unit_cost: '', batch_no: '', expiry_date: '', mfg_date: '', serial_numbers: '', note: '' });
      setSaved('Stock movement recorded.');
      loadReport();
      loadMovements();
      loadBatches();
      loadSerials();
    } catch (err) {
      setError(err.message);
    }
  };

  const batchStatus = (b) => {
    const oh = Number(b.on_hand);
    if (b.expiry_date) {
      const d = daysUntil(b.expiry_date);
      if (d < 0 && oh > 0) return <span className="badge badge-red">EXPIRED</span>;
      if (d <= 30 && oh > 0) return <span className="badge badge-amber">SOON ({d}d)</span>;
    }
    return null;
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
            <button className={`btn btn-sm ${tab === 'batches' ? 'btn-primary' : ''}`} onClick={() => pickTab('batches')}>Batches & Expiry</button>
            <button className={`btn btn-sm ${tab === 'serials' ? 'btn-primary' : ''}`} onClick={() => pickTab('serials')}>Serials</button>
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
                <label>Unit Cost (₹)</label>
                <input value={form.unit_cost} onChange={set('unit_cost')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Batch No</label>
                <input value={form.batch_no} onChange={set('batch_no')} placeholder="e.g. LOT2026-1" />
              </div>
              <div className="field">
                <label>Mfg Date</label>
                <input value={form.mfg_date} onChange={set('mfg_date')} type="date" />
              </div>
              <div className="field">
                <label>Expiry Date</label>
                <input value={form.expiry_date} onChange={set('expiry_date')} type="date" />
              </div>
              <div className="field">
                <label>Serial Numbers</label>
                <input value={form.serial_numbers} onChange={set('serial_numbers')} placeholder="comma separated, one per unit" />
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

        {tab === 'report' || tab === 'low' ? (
          loading ? (
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
          )
        ) : tab === 'batches' ? (
          batches.length === 0 ? (
            <div className="empty">No batch-tracked stock. Add stock with a batch number to track lots (FIFO issue on sale, expiry alerts).</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch No</th>
                  <th>Mfg</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th className="right">On Hand</th>
                  <th className="right">Unit Cost</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{b.product_name} <span className="muted">({b.sku})</span></td>
                    <td><b>{b.batch_no}</b></td>
                    <td>{b.mfg_date || '—'}</td>
                    <td>{b.expiry_date || '—'}</td>
                    <td>{batchStatus(b) || <span className="badge badge-green">OK</span>}</td>
                    <td className="right">{b.on_hand}</td>
                    <td className="right nowrap">{inr(b.unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : (
          serials.length === 0 ? (
            <div className="empty">No serialised stock. Tick Serialised on a product and receive stock with serial numbers.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Batch No</th>
                  <th className="right">Received</th>
                  <th className="right">Issued</th>
                  <th className="right">Available</th>
                  <th>Available Serials</th>
                </tr>
              </thead>
              <tbody>
                {serials.map((s, i) => (
                  <tr key={i}>
                    <td>{s.product_name} <span className="muted">({s.sku})</span></td>
                    <td>{s.batch_no || '—'}</td>
                    <td className="right">{s.total_received}</td>
                    <td className="right">{s.total_issued}</td>
                    <td className="right"><b>{s.remaining}</b></td>
                    <td className="muted">{listSerials(s.serials).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
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
                <th>Batch</th>
                <th>Serials</th>
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
                  <td className="nowrap">{m.batch_no ? <b>{m.batch_no}</b> : '—'}</td>
                  <td className="muted">{listSerials(m.serial_numbers).join(', ') || '—'}</td>
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