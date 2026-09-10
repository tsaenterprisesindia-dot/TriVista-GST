import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ImportCsv from '../components/ImportCsv';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const empty = {
  name: '',
  gstin: '',
  pan: '',
  phone: '',
  email: '',
  address_line1: '',
  city: '',
  state: '',
  state_code: '',
  pincode: '',
};

export default function Vendors() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(empty);

  const load = () => {
    setLoading(true);
    api
      .get(`/vendors?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`)
      .then((d) => {
        setRows(d.data || []);
        setTotal(d.total || 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [q, page]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const openNew = () => {
    setEditId(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (v) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      gstin: v.gstin,
      pan: v.pan,
      phone: v.phone,
      email: v.email,
      address_line1: '',
      city: v.city,
      state: v.state,
      state_code: v.state_code,
      pincode: '',
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      const res = editId
        ? await api.put(`/vendors/${editId}`, form)
        : await api.post('/vendors', form);
      setSaved(editId ? 'Vendor updated.' : `Vendor created with code ${res.vendor_code}.`);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">
          <input
            placeholder="Search name / GSTIN / city…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          <button className="btn btn-primary" onClick={openNew}>+ New Vendor</button>
        </div>

        <div className="card" style={{ marginTop: '10px' }}>
          <div className="card-title">Import Vendors from CSV</div>
          <ImportCsv kind="vendors" />
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} required />
              </div>
              <div className="field">
                <label>GSTIN</label>
                <input value={form.gstin} onChange={set('gstin')} />
              </div>
              <div className="field">
                <label>PAN</label>
                <input value={form.pan} onChange={set('pan')} maxLength={10} placeholder="Optional — avoids 5% TDS" />
              </div>
              <div className="field">
                <label>Phone</label>
                <input value={form.phone} onChange={set('phone')} />
              </div>
              <div className="field">
                <label>Email</label>
                <input value={form.email} onChange={set('email')} type="email" />
              </div>
              <div className="field">
                <label>Address</label>
                <input value={form.address_line1} onChange={set('address_line1')} />
              </div>
              <div className="field">
                <label>City</label>
                <input value={form.city} onChange={set('city')} />
              </div>
              <div className="field">
                <label>State</label>
                <input value={form.state} onChange={set('state')} />
              </div>
              <div className="field">
                <label>State Code (2 chars)</label>
                <input value={form.state_code} onChange={set('state_code')} maxLength={2} placeholder="e.g. 27" />
              </div>
              <div className="field">
                <label>Pincode</label>
                <input value={form.pincode} onChange={set('pincode')} />
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">{editId ? 'Save Changes' : 'Create Vendor'}</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Vendors</div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No vendors found.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>GSTIN</th>
                <th>PAN</th>
                <th>Phone</th>
                <th>Email</th>
                <th>City</th>
                <th>State</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="nowrap">{v.vendor_code || '—'}</td>
                  <td>{v.name}</td>
                  <td className="nowrap">{v.gstin || '—'}</td>
                  <td className="nowrap">{v.pan || '—'}</td>
                  <td className="nowrap">{v.phone || '—'}</td>
                  <td>{v.email || '—'}</td>
                  <td>{v.city || '—'}</td>
                  <td>{v.state || '—'}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openEdit(v)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="pagination">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
            <span>{page} / {pages}</span>
            <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </>
  );
}