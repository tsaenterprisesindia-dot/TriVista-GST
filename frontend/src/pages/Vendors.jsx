import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ImportCsv from '../components/ImportCsv';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const empty = {
  name: '',
  company_name: '',
  gstin: '',
  registration_category: '',
  tax_exempt: false,
  rcm_default: false,
  pan: '',
  phone: '',
  email: '',
  address_line1: '',
  city: '',
  state: '',
  state_code: '',
  pincode: '',
  opening_balance: '',
  tds_rate: '',
  tds_threshold: '',
  is_active: true,
};

const CAT = [
  { v: '', l: '— Auto (from GSTIN) —' },
  { v: 'registered', l: 'Registered (RCM: off)' },
  { v: 'unregistered', l: 'Unregistered (RCM: auto)' },
  { v: 'composition', l: 'Composition Dealer' },
  { v: 'sez', l: 'SEZ' },
  { v: 'export', l: 'Export' },
];

const catBadge = (v) => {
  const cat = v.registration_category || (v.gstin ? 'registered' : 'unregistered');
  if (cat === 'export') return <span className="badge badge-amber">EXP</span>;
  if (cat === 'sez') return <span className="badge badge-amber">SEZ</span>;
  if (cat === 'composition') return <span className="badge badge-amber">COMP</span>;
  return cat === 'unregistered' ? <span className="badge badge-gray">UNREG</span> : <span className="badge badge-green">REG</span>;
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

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const openNew = () => {
    setEditId(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (v) => {
    setEditId(v.id);
    setForm({
      name: v.name,
      company_name: v.company_name,
      gstin: v.gstin,
      registration_category: v.registration_category || '',
      tax_exempt: !!v.tax_exempt,
      rcm_default: !!v.rcm_default,
      pan: v.pan,
      phone: v.phone,
      email: v.email,
      address_line1: v.address_line1,
      city: v.city,
      state: v.state,
      state_code: v.state_code,
      pincode: v.pincode,
      opening_balance: v.opening_balance,
      tds_rate: v.tds_rate ?? '',
      tds_threshold: v.tds_threshold ?? '',
      is_active: !!v.is_active,
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
      setSaved(
        editId
          ? 'Vendor updated.'
          : `Vendor created with code ${res.vendor_code}.`
      );
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete vendor "${v.name}"?`)) return;
    setError('');
    setSaved('');
    try {
      const r = await api.del(`/vendors/${v.id}`);
      setSaved(r.message || 'Vendor deleted.');
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
                <label>Company</label>
                <input value={form.company_name} onChange={set('company_name')} />
              </div>
              <div className="field">
                <label>GSTIN</label>
                <input value={form.gstin} onChange={set('gstin')} placeholder="Optional" />
              </div>
              <div className="field">
                <label>Registration Category</label>
                <select value={form.registration_category} onChange={set('registration_category')}>
                  {CAT.map((c) => (
                    <option key={c.v} value={c.v}>{c.l}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.rcm_default} onChange={set('rcm_default')} style={{ width: 'auto' }} />{' '}
                  Default RCM
                </label>
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.tax_exempt} onChange={set('tax_exempt')} style={{ width: 'auto' }} />{' '}
                  Tax Exempt
                </label>
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
              <div className="field">
                <label>Opening Balance</label>
                <input value={form.opening_balance} onChange={set('opening_balance')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>TDS Rate %</label>
                <input value={form.tds_rate} onChange={set('tds_rate')} type="number" step="0.01" min="0" placeholder="Blank = company default" />
              </div>
              <div className="field">
                <label>TDS Threshold ₹</label>
                <input value={form.tds_threshold} onChange={set('tds_threshold')} type="number" step="1" min="0" placeholder="Blank = company default" />
              </div>
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.is_active} onChange={set('is_active')} style={{ width: 'auto' }} />{' '}
                  Active
                </label>
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
                <th>Company</th>
                <th>GSTIN</th>
                <th>PAN</th>
                <th>Phone</th>
                <th>City</th>
                <th className="right">Opening Balance</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="nowrap">{v.vendor_code || '—'}</td>
                  <td>{v.name}</td>
                  <td>{v.company_name || '—'}</td>
                  <td className="nowrap">
                    {v.gstin || '—'}
                    {v.gstin && <br />}
                    {catBadge(v)}
                  </td>
                  <td className="nowrap">{v.pan || '—'}</td>
                  <td className="nowrap">{v.phone || '—'}</td>
                  <td>{v.city || '—'}</td>
                  <td className="right nowrap">{inr(v.opening_balance)}</td>
                  <td>
                    {v.is_active ? <span className="badge badge-green">ACTIVE</span> : <span className="badge badge-gray">INACTIVE</span>}
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openEdit(v)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(v)}>Delete</button>
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