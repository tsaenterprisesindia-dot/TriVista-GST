import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const ABS = ['Purchase Bills', 'P&L', 'Balance Sheet', 'Day Book'];

const lineEmpty = () => ({ product_id: '', item_name: '', quantity: 1, unit_price: '', gst_rate: '', discount: 0 });

export default function Accounting() {
  const [tab, setTab] = useState(ABS[0]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [pform, setPform] = useState({ vendor_id: '', bill_date: today(), items: [lineEmpty()] });

  const [plFrom, setPlFrom] = useState(firstOfMonth());
  const [plTo, setPlTo] = useState(today());
  const [pl, setPl] = useState(null);

  const [bsFrom, setBsFrom] = useState(firstOfMonth());
  const [bsTo, setBsTo] = useState(today());
  const [bs, setBs] = useState(null);

  const [dayDate, setDayDate] = useState(today());
  const [dayBook, setDayBook] = useState([]);

  useEffect(() => {
    api.get('/vendors?limit=200').then((d) => setVendors(d.data || [])).catch(() => {});
    api.get('/products?limit=200').then((d) => setProducts(d.data || [])).catch(() => {});
    loadPurchases();
  }, []);

  const loadPurchases = () => {
    api.get('/accounting/purchases').then((d) => setPurchases(d.data || [])).catch(() => setPurchases([]));
  };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function firstOfMonth() {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  }

  const setItem = (i, k) => (e) => {
    const v = e.target.value;
    setPform((f) => {
      const items = f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it));
      if (k === 'product_id') {
        const p = products.find((p) => String(p.id) === String(v));
        if (p) {
          items[i] = { ...items[i], product_id: v, item_name: p.name, gst_rate: p.gst_rate, unit_price: p.purchase_price || p.selling_price };
        }
      }
      return { ...f, items };
    });
  };

  const setVendor = (e) => setPform((f) => ({ ...f, vendor_id: e.target.value }));

  const addItem = () => setPform((f) => ({ ...f, items: [...f.items, lineEmpty()] }));
  const dropItem = (i) => setPform((f) => ({ ...f, items: f.items.filter((_, idx) => idx !== i) }));

  const submitPurchase = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.post('/accounting/purchases', pform);
      setSaved('Purchase bill created.');
      setShowForm(false);
      setPform({ vendor_id: '', bill_date: today(), items: [lineEmpty()] });
      loadPurchases();
    } catch (err) {
      setError(err.message);
    }
  };

  const earn = async (p) => {
    try {
      await api.post(`/accounting/purchases/${p.id}/pay`, { amount: p.balance_due, mode: 'BANK', date: today() });
      loadPurchases();
    } catch (err) {
      setError(err.message);
    }
  };

  const loadPL = () => {
    api.get(`/accounting/pnl?from=${plFrom}&to=${plTo}`).then(setPl).catch((e) => setError(e.message));
  };

  const loadBS = () => {
    api.get(`/accounting/balance-sheet?from=${bsFrom}&to=${bsTo}`).then(setBs).catch((e) => setError(e.message));
  };

  const loadDayBook = () => {
    api.get(`/accounting/daybook?date=${dayDate}`).then((d) => setDayBook(d.entries || [])).catch(() => setDayBook([]));
  };

  useEffect(() => { loadPL(); }, []);
  useEffect(() => { loadBS(); }, []);
  useEffect(() => { loadDayBook(); }, []);

  const plRows = pl?.rows.map((r) => ({
    account: r.name || r.account,
    balance: Number(r.c) - Number(r.d) + Number(r.opening_balance || 0),
    type: r.type,
  })) || [];
  const bsRows = bs?.accounts.map((a) => ({
    account: a.name,
    type: a.type,
    balance: Number(a.opening_balance) + Number(a.balance),
  })) || [];

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="card">
        <div className="card-title">
          <div className="flex">
            {ABS.map((t) => (
              <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : ''}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
        </div>

        {tab === 'Purchase Bills' && (
          <>
            <div className="card-title">
              <span>Purchase Bills</span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowForm((v) => !v)}>+ New Purchase</button>
            </div>

            {showForm && (
              <form onSubmit={submitPurchase} className="mb">
                <div className="grid-3">
                  <div className="field">
                    <label>Vendor</label>
                    <select value={pform.vendor_id} onChange={setVendor} required>
                      <option value="">— Select —</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>{v.name} ({v.vendor_code})</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Bill Date</label>
                    <input type="date" value={pform.bill_date} onChange={(e) => setPform((f) => ({ ...f, bill_date: e.target.value }))} required />
                  </div>
                </div>

                {pform.items.map((it, i) => (
                  <div key={i} className="grid-3">
                    <div className="field">
                      <label>Product</label>
                      <select value={it.product_id} onChange={setItem(i, 'product_id')} required>
                        <option value="">— Select —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>Item Name</label>
                      <input value={it.item_name} onChange={setItem(i, 'item_name')} required />
                    </div>
                    <div className="field">
                      <label>Qty</label>
                      <input type="number" value={it.quantity} onChange={setItem(i, 'quantity')} required />
                    </div>
                    <div className="field">
                      <label>Unit Price</label>
                      <input type="number" step="0.01" value={it.unit_price} onChange={setItem(i, 'unit_price')} required />
                    </div>
                    <div className="field">
                      <label>GST %</label>
                      <input type="number" step="0.01" value={it.gst_rate} onChange={setItem(i, 'gst_rate')} />
                    </div>
                    <div className="field">
                      <label>Discount</label>
                      <input type="number" step="0.01" value={it.discount} onChange={setItem(i, 'discount')} />
                    </div>
                    <div className="field">
                      <button type="button" className="btn btn-sm btn-danger" onClick={() => dropItem(i)}>Remove</button>
                    </div>
                  </div>
                ))}
                <button type="button" className="btn btn-sm" onClick={addItem}>+ Add Item</button>
                <div className="mt flex">
                  <button className="btn btn-primary" type="submit">Save Purchase</button>
                  <button className="btn" type="button" onClick={() => setShowForm(false)}>Cancel</button>
                </div>
              </form>
            )}

            {purchases.length === 0 ? (
              <div className="empty">No purchase bills.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Bill No</th>
                    <th>Vendor</th>
                    <th>Date</th>
                    <th className="right">Grand Total</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p) => (
                    <tr key={p.id}>
                      <td className="nowrap">{p.bill_number || '—'}</td>
                      <td>{p.vendor_name}</td>
                      <td className="nowrap">{p.bill_date}</td>
                      <td className="right nowrap">{inr(p.grand_total)}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="nowrap">
                        <button className="btn btn-sm" onClick={() => earn(p)}>Pay</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'P&L' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>From</label>
                  <input type="date" value={plFrom} onChange={(e) => setPlFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To</label>
                  <input type="date" value={plTo} onChange={(e) => setPlTo(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadPL}>Load</button>
              </div>
            </div>
            {pl && (
              <div className="stats-grid">
                <div className="stat-card"><div className="label">Income</div><div className="value" style={{ color: 'var(--green)' }}>{inr(pl.income)}</div></div>
                <div className="stat-card"><div className="label">Expense</div><div className="value" style={{ color: 'var(--red)' }}>{inr(pl.expense)}</div></div>
                <div className="stat-card">
                  <div className="label">Profit</div>
                  <div className="value" style={{ color: Number(pl.profit) >= 0 ? 'var(--green)' : 'var(--red)' }}>{inr(pl.profit)}</div>
                </div>
              </div>
            )}
            <table>
              <thead><tr><th>Account</th><th>Type</th><th className="right">Balance</th></tr></thead>
              <tbody>
                {plRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.account}</td>
                    <td>{r.type}</td>
                    <td className="right nowrap">{inr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === 'Balance Sheet' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>From</label>
                  <input type="date" value={bsFrom} onChange={(e) => setBsFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To</label>
                  <input type="date" value={bsTo} onChange={(e) => setBsTo(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadBS}>Load</button>
              </div>
            </div>
            {bs && (
              <div className="stats-grid">
                <div className="stat-card"><div className="label">Inventory Value</div><div className="value">{inr(bs.inventoryValue)}</div></div>
                <div className="stat-card"><div className="label">Receivables</div><div className="value">{inr(bs.receivables)}</div></div>
                <div className="stat-card"><div className="label">Payables</div><div className="value">{inr(bs.payables)}</div></div>
              </div>
            )}
            <table>
              <thead><tr><th>Account</th><th>Type</th><th className="right">Balance</th></tr></thead>
              <tbody>
                {bsRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.account}</td>
                    <td>{r.type}</td>
                    <td className="right nowrap">{inr(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === 'Day Book' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={dayDate} onChange={(e) => setDayDate(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadDayBook}>Load</button>
              </div>
            </div>
            {dayBook.length === 0 ? (
              <div className="empty">No entries for this date.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Voucher</th>
                    <th>Number</th>
                    <th>Party</th>
                    <th className="right">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dayBook.map((d, i) => (
                    <tr key={i}>
                      <td>{d.voucher_type}</td>
                      <td className="nowrap">{d.number}</td>
                      <td>{d.party}</td>
                      <td className="right nowrap">{inr(d.amount)}</td>
                      <td><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}