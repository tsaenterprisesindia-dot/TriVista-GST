import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ImportCsv from '../components/ImportCsv';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const empty = {
  name: '',
  legal_name: '',
  company_name: '',
  gstin: '',
  registration_category: '',
  tax_exempt: false,
  pan: '',
  phone: '',
  email: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  state_code: '',
  pincode: '',
  opening_balance: '',
  credit_limit: '',
  tds_rate: '',
  tcs_rate: '',
  tds_threshold: '',
  tcs_threshold: '',
  is_active: true,
};

const CAT = [
  { v: '', l: '— Auto (from GSTIN) —' },
  { v: 'registered', l: 'Registered (B2B)' },
  { v: 'unregistered', l: 'Unregistered (B2C)' },
  { v: 'composition', l: 'Composition Dealer' },
  { v: 'sez', l: 'SEZ' },
  { v: 'export', l: 'Export' },
];

const catBadge = (c) => {
  const cat = c.registration_category || (c.gstin ? 'registered' : 'unregistered');
  if (cat === 'export') return <span className="badge badge-amber">EXP</span>;
  if (cat === 'sez') return <span className="badge badge-amber">SEZ</span>;
  if (cat === 'composition') return <span className="badge badge-amber">COMP</span>;
  return cat === 'unregistered' ? <span className="badge badge-gray">B2C</span> : <span className="badge badge-green">B2B</span>;
};

export default function Customers() {
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
      .get(`/customers?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`)
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

  const openEdit = (c) => {
    setEditId(c.id);
    setForm({
      name: c.name,
      legal_name: c.legal_name,
      company_name: c.company_name,
      gstin: c.gstin,
      registration_category: c.registration_category || '',
      tax_exempt: !!c.tax_exempt,
      pan: c.pan,
      phone: c.phone,
      email: c.email,
      address_line1: c.address_line1,
      address_line2: c.address_line2,
      city: c.city,
      state: c.state,
      state_code: c.state_code,
      pincode: c.pincode,
      opening_balance: c.opening_balance,
      credit_limit: c.credit_limit,
      tds_rate: c.tds_rate ?? '',
      tcs_rate: c.tcs_rate ?? '',
      tds_threshold: c.tds_threshold ?? '',
      tcs_threshold: c.tcs_threshold ?? '',
      is_active: !!c.is_active,
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      const res = editId
        ? await api.put(`/customers/${editId}`, form)
        : await api.post('/customers', form);
      setSaved(
        editId
          ? 'Customer updated.'
          : `Customer created with code ${res.customer_code}.`
      );
      setShowForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete customer "${c.name}"?`)) return;
    await api.del(`/customers/${c.id}`);
    load();
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">
          <input
            placeholder="Search name / GSTIN / phone…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            style={{ width: 280 }}
          />
          <button className="btn btn-primary" onClick={openNew}>+ New Customer</button>
        </div>

        <div className="card" style={{ marginTop: '10px' }}>
          <div className="card-title">Import Customers from CSV</div>
          <ImportCsv kind="customers" />
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} required placeholder="Person / business name" />
              </div>
              <div className="field">
                <label>Legal Name *</label>
                <input value={form.legal_name} onChange={set('legal_name')} required placeholder="Registered / legal name" />
              </div>
              <div className="field">
                <label>Trade Name (Optional)</label>
                <input value={form.company_name} onChange={set('company_name')} placeholder="Brand name, e.g. store / business name" />
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
                  <input type="checkbox" checked={form.tax_exempt} onChange={set('tax_exempt')} style={{ width: 'auto' }} />{' '}
                  Tax Exempt (nil-rated invoices)
                </label>
              </div>
              <div className="field">
                <label>PAN</label>
                <input value={form.pan} onChange={set('pan')} maxLength={10} placeholder="Optional — avoids 1% TCS" />
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
                <label>Address Line 1</label>
                <input value={form.address_line1} onChange={set('address_line1')} />
              </div>
              <div className="field">
                <label>Address Line 2</label>
                <input value={form.address_line2} onChange={set('address_line2')} />
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
                <label>Credit Limit</label>
                <input value={form.credit_limit} onChange={set('credit_limit')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>TCS Rate %</label>
                <input value={form.tcs_rate} onChange={set('tcs_rate')} type="number" step="0.01" min="0" placeholder="Blank = company default" />
              </div>
              <div className="field">
                <label>TCS Threshold ₹</label>
                <input value={form.tcs_threshold} onChange={set('tcs_threshold')} type="number" step="1" min="0" placeholder="Blank = company default" />
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
              <button className="btn btn-primary" type="submit">{editId ? 'Save Changes' : 'Create Customer'}</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Customers</div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No customers found.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Legal Name</th>
                <th>Trade Name</th>
                <th>GSTIN</th>
                <th>PAN</th>
                <th>Phone</th>
                <th>City</th>
                <th className="right">Balance Due</th>
                <th className="right">Credit Limit</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="nowrap">{c.customer_code || '—'}</td>
                  <td>{c.name}</td>
                  <td>{c.legal_name || '—'}</td>
                  <td>{c.company_name || '—'}</td>
                  <td className="nowrap">
                    {c.gstin || '—'}
                    {c.gstin && <br />}
                    {catBadge(c)}
                  </td>
                  <td className="nowrap">{c.pan || '—'}</td>
                  <td className="nowrap">{c.phone || '—'}</td>
                  <td>{c.city || '—'}</td>
                  <td className="right nowrap">
                    {Number(c.outstanding_balance) > 0 ? (
                      <span className="badge badge-red">{inr(c.outstanding_balance)}</span>
                    ) : (
                      <span className="badge badge-green">{inr(c.outstanding_balance)}</span>
                    )}
                  </td>
                  <td className="right nowrap">{inr(c.credit_limit)}</td>
                  <td>
                    {c.is_active ? <span className="badge badge-green">ACTIVE</span> : <span className="badge badge-gray">INACTIVE</span>}
                  </td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openEdit(c)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(c)}>Delete</button>
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