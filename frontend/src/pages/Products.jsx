import { useEffect, useState } from 'react';
import { api } from '../api/client';
import ImportCsv from '../components/ImportCsv';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const empty = {
  sku: '',
  barcode: '',
  name: '',
  description: '',
  category_id: '',
  hsn_code: '',
  gst_rate: '',
  unit: 'PCS',
  selling_price: '',
  wholesale_price: '',
  purchase_price: '',
  mrp: '',
  min_stock: '',
  weight_kg: '',
  is_service: false,
  opening_stock: '',
};

export default function Products() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(empty);
  const [categories, setCategories] = useState([]);
  const [hsnOptions, setHsnOptions] = useState([]);

  const load = () => {
    setLoading(true);
    api
      .get(`/products?q=${encodeURIComponent(q)}&page=${page}&limit=${limit}`)
      .then((d) => {
        setRows(d.data || []);
        setTotal(d.total || 0);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, [q, page]);

  useEffect(() => {
    api.get('/products/categories').then(setCategories).catch(() => {});
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const onHsn = (e) => {
    const v = e.target.value;
    setForm((f) => ({ ...f, hsn_code: v }));
    if (v.length >= 2) {
      api
        .get(`/hsn?q=${encodeURIComponent(v)}`)
        .then(setHsnOptions)
        .catch(() => {});
    }
  };

  const onHsnSelect = () => {
    const hit = hsnOptions.find((h) => h.code === form.hsn_code);
    if (hit) setForm((f) => ({ ...f, gst_rate: hit.gst_rate }));
  };

  const openNew = () => {
    setEditId(null);
    setForm(empty);
    setShowForm(true);
  };

  const openEdit = (p) => {
    setEditId(p.id);
    setForm({
      ...empty,
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      category_id: p.category_id ? String(p.category_id) : '',
      hsn_code: p.hsn_code,
      gst_rate: p.gst_rate,
      unit: p.unit,
      selling_price: p.selling_price,
      wholesale_price: p.wholesale_price,
      purchase_price: p.purchase_price,
      mrp: p.mrp,
      min_stock: p.min_stock,
      weight_kg: p.weight_kg,
      is_service: !!p.is_service,
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = { ...form };
    if (editId) {
      delete body.opening_stock;
      await api.put(`/products/${editId}`, body);
    } else {
      await api.post('/products', body);
    }
    setShowForm(false);
    load();
  };

  const remove = async (p) => {
    if (!window.confirm(`Delete product "${p.name}"?`)) return;
    await api.del(`/products/${p.id}`);
    load();
  };

  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="card-title">
          <div className="flex">
            <input
              placeholder="Search SKU / name / barcode…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              style={{ width: 260 }}
            />
          </div>
          <button className="btn btn-primary" onClick={openNew}>+ New Product</button>
        </div>

        <div className="card" style={{ marginTop: '10px' }}>
          <div className="card-title">Import Products from CSV</div>
          <ImportCsv kind="products" />
        </div>

        <div className="card" style={{ marginTop: '10px' }}>
          <div className="card-title">Import HSN / SAC Master from CSV</div>
          <ImportCsv kind="hsn" />
        </div>

        {showForm && (
          <form onSubmit={submit} className="mb">
            <div className="grid-3">
              <div className="field">
                <label>SKU *</label>
                <input value={form.sku} onChange={set('sku')} required />
              </div>
              <div className="field">
                <label>Barcode</label>
                <input value={form.barcode} onChange={set('barcode')} />
              </div>
              <div className="field">
                <label>Name *</label>
                <input value={form.name} onChange={set('name')} required />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={form.description} onChange={set('description')} />
              </div>
              <div className="field">
                <label>Category</label>
                <select value={form.category_id} onChange={set('category_id')}>
                  <option value="">— Select —</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>HSN Code</label>
                <input list="hsn-list" value={form.hsn_code} onChange={onHsn} onBlur={onHsnSelect} placeholder="Type to search…" />
                <datalist id="hsn-list">
                  {hsnOptions.map((h) => (
                    <option key={h.id} value={h.code}>
                      {h.description} @ {h.gst_rate}%
                    </option>
                  ))}
                </datalist>
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
                <label>Selling Price (Retail)</label>
                <input value={form.selling_price} onChange={set('selling_price')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Wholesale Price</label>
                <input value={form.wholesale_price} onChange={set('wholesale_price')} type="number" step="0.01" placeholder="Leave blank to use retail price" />
              </div>
              <div className="field">
                <label>Purchase Price</label>
                <input value={form.purchase_price} onChange={set('purchase_price')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>MRP</label>
                <input value={form.mrp} onChange={set('mrp')} type="number" step="0.01" />
              </div>
              <div className="field">
                <label>Min Stock</label>
                <input value={form.min_stock} onChange={set('min_stock')} type="number" />
              </div>
              <div className="field">
                <label>Unit Weight (kg)</label>
                <input value={form.weight_kg} onChange={set('weight_kg')} type="number" step="0.001" placeholder="For e-Way Bill gross weight" />
              </div>
              {!editId && (
                <div className="field">
                  <label>Opening Stock</label>
                  <input value={form.opening_stock} onChange={set('opening_stock')} type="number" />
                </div>
              )}
              <div className="field">
                <label>
                  <input type="checkbox" checked={form.is_service} onChange={set('is_service')} style={{ width: 'auto' }} />{' '}
                  Is Service
                </label>
              </div>
            </div>
            <div className="flex">
              <button className="btn btn-primary" type="submit">{editId ? 'Save Changes' : 'Create Product'}</button>
              <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card-title">Products</div>
        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="empty">No products found.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Barcode</th>
                <th>Name</th>
                <th>Category</th>
                <th>HSN</th>
                <th>GST%</th>
                <th>Unit</th>
                <th className="right">Selling</th>
                <th className="right">Wholesale</th>
                <th className="right">Stock</th>
                <th>Service</th>
                <th className="right">Wt (kg)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="nowrap">{p.sku}</td>
                  <td className="nowrap">{p.barcode || '—'}</td>
                  <td>{p.name}</td>
                  <td>{p.category_name || '—'}</td>
                  <td className="nowrap">{p.hsn_code || '—'}</td>
                  <td>{p.gst_rate}%</td>
                  <td>{p.unit}</td>
                  <td className="right nowrap">{inr(p.selling_price)}</td>
                  <td className="right nowrap">{p.wholesale_price ? inr(p.wholesale_price) : '—'}</td>
                  <td className="right">{Number(p.stock_on_hand) || 0}</td>
                  <td>{p.is_service ? <span className="badge badge-blue">SERVICE</span> : <span className="badge badge-gray">GOODS</span>}</td>
                  <td className="right nowrap">{p.weight_kg ? Number(p.weight_kg).toFixed(2) : '—'}</td>
                  <td className="nowrap">
                    <button className="btn btn-sm" onClick={() => openEdit(p)}>Edit</button>{' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(p)}>Delete</button>
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