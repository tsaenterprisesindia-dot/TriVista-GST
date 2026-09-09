import { useEffect, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const today = () => new Date().toISOString().slice(0, 10);

const empty = {
  customer_id: '',
  title: '',
  hsn_code: '',
  gst_rate: '18',
  unit: 'PCS',
  quantity: '1',
  unit_price: '',
  frequency: 'MONTHLY',
  next_run_date: today(),
  payment_mode: 'CREDIT',
  is_active: true,
  notes: '',
};

const FREQ_LABEL = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-yearly',
  YEARLY: 'Yearly',
};

export default function Recurring() {
  const [rows, setRows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(empty);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .get('/recurring')
      .then((d) => setRows(d || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get('/customers?limit=100').then((d) => setCustomers(d || [])).catch(() => {});
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const openNew = () => {
    setEditId(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (r) => {
    setEditId(r.id);
    setForm({
      customer_id: String(r.customer_id),
      title: r.title,
      hsn_code: r.hsn_code || '',
      gst_rate: r.gst_rate,
      unit: r.unit,
      quantity: r.quantity,
      unit_price: r.unit_price,
      frequency: r.frequency,
      next_run_date: r.next_run_date ? r.next_run_date.slice(0, 10) : today(),
      payment_mode: r.payment_mode,
      is_active: !!r.is_active,
      notes: r.notes || '',
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setMsg('');
    try {
      if (editId) await api.put(`/recurring/${editId}`, form);
      else await api.post('/recurring', form);
      setShowForm(false);
      load();
      setMsg(editId ? 'Recurring template updated.' : 'Recurring template created.');
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleActive = async (r) => {
    try {
      await api.put(`/recurring/${r.id}`, { is_active: r.is_active ? 0 : 1 });
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete recurring template "${r.title}"?`)) return;
    try {
      await api.del(`/recurring/${r.id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const runNow = async () => {
    setBusy(true);
    setMsg('');
    setError('');
    try {
      const d = await api.post('/recurring/generate', {});
      setMsg(d.message || 'Generation finished.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {msg && <div className="success-banner">{msg}</div>}
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-title">
          <span>Recurring Invoices</span>
          <div className="flex">
            <button className="btn" onClick={runNow} disabled={busy}>
              {busy ? 'Generating…' : 'Generate Due Now'}
            </button>
            <button className="btn btn-primary" onClick={openNew}>+ New Recurring</button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Customer *</label>
                <select value={form.customer_id} onChange={set('customer_id')} required>
                  <option value="">— Select —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Service / Item Title *</label>
                <input value={form.title} onChange={set('title')} required placeholder="e.g. AMC – Annual Maintenance" />
              </div>
              <div className="field">
                <label>HSN / SAC</label>
                <input value={form.hsn_code} onChange={set('hsn_code')} />
              </div>
              <div className="field">
                <label>GST %</label>
                <input value={form.gst_rate} onChange={set('gst_rate')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Unit</label>
                <input value={form.unit} onChange={set('unit')} />
              </div>
              <div className="field">
                <label>Qty</label>
                <input value={form.quantity} onChange={set('quantity')} type="number" min="0" step="0.01" />
              </div>
              <div className="field">
                <label>Unit Price</label>
                <input value={form.unit_price} onChange={set('unit_price')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Frequency</label>
                <select value={form.frequency} onChange={set('frequency')}>
                  {Object.keys(FREQ_LABEL).map((f) => (
                    <option key={f} value={f}>{FREQ_LABEL[f]}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Next Run Date</label>
                <input type="date" value={form.next_run_date} onChange={set('next_run_date')} />
              </div>
              <div className="field">
                <label>Payment Mode</label>
                <select value={form.payment_mode} onChange={set('payment_mode')}>
                  <option value="CREDIT">Credit</option>
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="UPI">UPI</option>
                  <option value="BANK">Bank</option>
                  <option value="OTHER">Other</option>
                </select>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.is_active} onChange={set('is_active')} style={{ width: 'auto' }} />{' '}
                  Active
                </label>
              </div>
              <div className="field">
                <label>Notes</label>
                <input value={form.notes} onChange={set('notes')} />
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">{editId ? 'Save Changes' : 'Create Template'}</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Templates</div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No recurring templates. Create one to auto-generate invoices.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Customer</th>
                <th className="right">Amount</th>
                <th>Frequency</th>
                <th>Next Run</th>
                <th>Last Run</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.title}</td>
                  <td>{r.customer_name}</td>
                  <td className="right nowrap">{inr((Number(r.unit_price) || 0) * (Number(r.quantity) || 1))}</td>
                  <td>{FREQ_LABEL[r.frequency] || r.frequency}</td>
                  <td className="nowrap">{r.next_run_date ? r.next_run_date.slice(0, 10) : '—'}</td>
                  <td className="nowrap">{r.last_run_date ? r.last_run_date.slice(0, 10) : '—'}</td>
                  <td>{r.payment_mode}</td>
                  <td>
                    {r.is_active ? <span className="badge badge-green">ACTIVE</span> : <span className="badge badge-gray">PAUSED</span>}
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => toggleActive(r)}>{r.is_active ? 'Pause' : 'Resume'}</button>{' '}
                    <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}