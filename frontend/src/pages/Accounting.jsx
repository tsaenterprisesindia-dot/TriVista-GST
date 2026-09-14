import { Fragment, useEffect, useState } from 'react';
import { api } from '../api/client';
import { StatusBadge } from './Dashboard';
import PaymentSplit from '../components/PaymentSplit';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const ABS = ['Purchase Bills', 'Journal', 'Ledger', 'Trial Balance', 'P&L', 'Balance Sheet', 'Cash & Bank', 'Day Book', 'Chart of Accounts'];

const lineEmpty = () => ({ product_id: '', item_name: '', quantity: 1, unit_price: '', gst_rate: '', cess_rate: '', discount: 0, batch_no: '', expiry_date: '', serial_numbers: '' });
const jLineEmpty = () => ({ account_id: '', debit: '', credit: '' });
const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

export default function Accounting() {
  const [tab, setTab] = useState(ABS[0]);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const [vendors, setVendors] = useState([]);
  const [products, setProducts] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [pform, setPform] = useState({ vendor_id: '', bill_date: today(), is_rcm: false, items: [lineEmpty()] });
  const [payOpen, setPayOpen] = useState(null);
  const [payRows, setPayRows] = useState([]);
  const [payDate, setPayDate] = useState(today());

  const [plFrom, setPlFrom] = useState(firstOfMonth());
  const [plTo, setPlTo] = useState(today());
  const [pl, setPl] = useState(null);

  const [bsFrom, setBsFrom] = useState(firstOfMonth());
  const [bsTo, setBsTo] = useState(today());
  const [bs, setBs] = useState(null);

  const [dayDate, setDayDate] = useState(today());
  const [dayBook, setDayBook] = useState([]);

  const [accounts, setAccounts] = useState([]);

  const [jDate, setJDate] = useState(today());
  const [jNarration, setJNarration] = useState('');
  const [jLines, setJLines] = useState([jLineEmpty()]);
  const [journal, setJournal] = useState([]);

  const [naAccountId, setNaAccountId] = useState('');
  const [naFrom, setNaFrom] = useState(firstOfMonth());
  const [naTo, setNaTo] = useState(today());
  const [lg, setLg] = useState(null);

  const [tbAsOf, setTbAsOf] = useState(today());
  const [tb, setTb] = useState(null);

  const [cbAccountId, setCbAccountId] = useState('');
  const [cbFrom, setCbFrom] = useState(firstOfMonth());
  const [cbTo, setCbTo] = useState(today());
  const [cb, setCb] = useState(null);

  const [acctForm, setAcctForm] = useState({ code: '', name: '', type: 'ASSET', parent_id: '', opening_balance: 0, is_active: true });

  useEffect(() => {
    api.get('/vendors?limit=200').then((d) => setVendors(d.data || [])).catch(() => {});
    api.get('/products?limit=200').then((d) => setProducts(d.data || [])).catch(() => {});
    api.get('/accounts').then((d) => setAccounts(d.data || [])).catch(() => {});
    loadPurchases();
    loadJournal();
    loadAccounts();
  }, []);

  useEffect(() => {
    if (!naAccountId && accounts.length) {
      const def = accounts.find((a) => a.type === 'ASSET') || accounts[0];
      if (def) setNaAccountId(def.id);
    }
    if (!cbAccountId && accounts.length) {
      const cb = accounts.find((a) => a.code === '1000') || accounts.find((a) => a.type === 'ASSET') || accounts[0];
      if (cb) setCbAccountId(cb.id);
    }
    if (tab === 'Cash & Bank' && cbAccountId) loadCB();
    if (tab === 'Ledger' && naAccountId) loadLedger();
    if (tab === 'Trial Balance') loadTB();
  }, [accounts, tab]);

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function firstOfMonth() {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  }

  const loadPurchases = () => {
    api.get('/accounting/purchases').then((d) => setPurchases(d.data || [])).catch(() => setPurchases([]));
  };

  const loadAccounts = () => {
    api.get('/accounts').then((d) => setAccounts(d.data || [])).catch(() => setAccounts([]));
  };

  const loadJournal = () => {
    api.get('/accounts/journal').then((d) => setJournal(d.data || [])).catch(() => setJournal([]));
  };

  const loadLedger = () => {
    if (!naAccountId) return;
    api.get(`/accounts/ledger?account_id=${naAccountId}&from=${naFrom}&to=${naTo}`).then(setLg).catch((e) => setError(e.message));
  };

  const loadTB = () => {
    api.get(`/accounts/trial-balance?asof=${tbAsOf}`).then(setTb).catch((e) => setError(e.message));
  };

  const loadCB = () => {
    if (!cbAccountId) return;
    api.get(`/accounts/cash-bank?account_id=${cbAccountId}&from=${cbFrom}&to=${cbTo}`).then(setCb).catch((e) => setError(e.message));
  };

  useEffect(() => { loadPL(); }, []);
  useEffect(() => { loadBS(); }, []);
  useEffect(() => { loadDayBook(); }, []);

  const setItem = (i, k) => (e) => {
    const v = e.target.value;
    setPform((f) => {
      const items = f.items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it));
      if (k === 'product_id') {
        const p = products.find((p) => String(p.id) === String(v));
        if (p) {
          items[i] = { ...items[i], product_id: v, item_name: p.name, gst_rate: p.gst_rate, cess_rate: p.cess_rate || '', unit_price: p.purchase_price || p.selling_price };
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

  const submitSplitPay = async (p) => {
    const rows = (payRows || []).filter((r) => r && Number(r.amount) > 0);
    if (!rows.length) return setError('Enter at least one payment.');
    try {
      await api.post(`/accounting/purchases/${p.id}/pay`, {
        date: payDate,
        payments: rows.map((r) => ({ mode: r.mode, amount: Number(r.amount), reference_no: r.reference_no || null })),
      });
      setPayOpen(null);
      setPayRows([]);
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

  const plRows = pl?.rows.map((r) => ({
    account: r.name || r.account,
    balance: r.balance !== undefined ? r.balance : Number(r.c) - Number(r.d) + Number(r.opening_balance || 0),
    type: r.type,
  })) || [];
  const bsRows = bs?.accounts.map((a) => ({
    account: a.name,
    type: a.type,
    balance: a.balance !== undefined ? a.balance : Number(a.opening_balance) + Number(a.balance || 0),
  })) || [];

  // ---- Journal helpers ----
  const setJLine = (i, k) => (e) => {
    const v = e.target.value;
    setJLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));
  };
  const addJLine = () => setJLines((ls) => [...ls, jLineEmpty()]);
  const dropJLine = (i) => setJLines((ls) => ls.filter((_, idx) => idx !== i));
  const jDr = jLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const jCr = jLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const jBalanced = jLines.every((l) => l.account_id) && jLines.some((l) => Number(l.debit) > 0 || Number(l.credit) > 0) && Math.abs(jDr - jCr) < 0.01;
  const submitJournal = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    if (!jBalanced) {
      setError('Total debits must equal total credits.');
      return;
    }
    try {
      await api.post('/accounts/journal', {
        date: jDate,
        narration: jNarration,
        entries: jLines.map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })),
      });
      setSaved('Journal voucher posted.');
      setJNarration('');
      setJLines([jLineEmpty()]);
      loadJournal();
    } catch (err) {
      setError(err.message);
    }
  };
  const voidJournal = async (id) => {
    if (!window.confirm('Void this journal voucher? This cannot be undone.')) return;
    try {
      await api.del(`/accounts/journal/${id}`);
      loadJournal();
    } catch (err) {
      setError(err.message);
    }
  };

  // ---- Chart of Accounts helpers ----
  const setAcct = (k) => (e) => setAcctForm((f) => ({ ...f, [k]: e.target.value }));
  const submitAccount = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.post('/accounts', acctForm);
      setSaved('Account created.');
      setAcctForm({ code: '', name: '', type: 'ASSET', parent_id: '', opening_balance: 0, is_active: true });
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };
  const toggleAccount = async (a) => {
    try {
      await api.put(`/accounts/${a.id}`, { is_active: a.is_active ? 0 : 1 });
      loadAccounts();
    } catch (err) {
      setError(err.message);
    }
  };
  const deleteAccount = async (a) => {
    if (!window.confirm(`Delete account "${a.name}" (${a.code})?`)) return;
    try {
      await api.del(`/accounts/${a.id}`);
      loadAccounts();
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
                  <div className="field">
                    <label>Reverse Charge (RCM)</label>
                    <select value={pform.is_rcm ? 1 : 0} onChange={(e) => setPform((f) => ({ ...f, is_rcm: e.target.value === '1' }))}>
                      <option value="0">No (regular purchase)</option>
                      <option value="1">Yes (goods/services from unregistered supplier)</option>
                    </select>
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
                      <label>Cess %</label>
                      <input type="number" step="0.01" value={it.cess_rate} onChange={setItem(i, 'cess_rate')} placeholder="compensation cess" />
                    </div>
                    <div className="field">
                      <label>Discount</label>
                      <input type="number" step="0.01" value={it.discount} onChange={setItem(i, 'discount')} />
                    </div>
                    <div className="field">
                      <label>Batch No</label>
                      <input value={it.batch_no || ''} onChange={setItem(i, 'batch_no')} placeholder="optional (FIFO + expiry)" />
                    </div>
                    <div className="field">
                      <label>Expiry Date</label>
                      <input type="date" value={it.expiry_date || ''} onChange={setItem(i, 'expiry_date')} />
                    </div>
                    <div className="field">
                      <label>Serial Numbers</label>
                      <input value={it.serial_numbers || ''} onChange={setItem(i, 'serial_numbers')} placeholder="comma separated for serialised" />
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
                  <Fragment key={p.id}>
                    <tr>
                      <td className="nowrap">{p.bill_number || '—'}</td>
                      <td>{p.vendor_name}</td>
                      <td className="nowrap">{p.bill_date}</td>
                      <td className="right nowrap">{inr(p.grand_total)}</td>
                      <td><StatusBadge status={p.status} /></td>
                      <td className="nowrap">
                        {Number(p.balance_due) > 0 ? (
                          <>
                            <button className="btn btn-sm" onClick={() => earn(p)}>Pay (Bank)</button>
                            <button className="btn btn-sm" onClick={() => { setPayOpen(payOpen === p.id ? null : p.id); setPayRows([]); }}>
                              {payOpen === p.id ? 'Close' : 'Split'}
                            </button>
                          </>
                        ) : (
                          <span className="muted">Settled</span>
                        )}
                      </td>
                    </tr>
                    {payOpen === p.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: 12 }}>
                          <div className="row mb">
                            <div>
                              <label>Payment Date</label>
                              <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
                            </div>
                            <div className="muted" style={{ alignSelf: 'flex-end', fontSize: 12 }}>Balance due: {inr(p.balance_due)}</div>
                          </div>
                          <PaymentSplit
                            total={p.balance_due}
                            value={payRows}
                            onChange={setPayRows}
                            withReference
                            label="Split payment"
                          />
                          <div className="mt flex" style={{ justifyContent: 'flex-end', gap: 8 }}>
                            <button type="button" className="btn btn-sm" onClick={() => { setPayOpen(null); setPayRows([]); }}>Cancel</button>
                            <button type="button" className="btn btn-sm btn-primary" onClick={() => submitSplitPay(p)}>Record Split Payment</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'Journal' && (
          <>
            <div className="card-title"><span>Journal Voucher</span></div>
            <form onSubmit={submitJournal} className="mb">
              <div className="row">
                <div className="field">
                  <label>Date</label>
                  <input type="date" value={jDate} onChange={(e) => setJDate(e.target.value)} required />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <label>Narration</label>
                  <input value={jNarration} onChange={(e) => setJNarration(e.target.value)} placeholder="e.g. Owner capital introduced" />
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="right">Debit (Dr)</th>
                    <th className="right">Credit (Cr)</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {jLines.map((l, i) => (
                    <tr key={i}>
                      <td>
                        <select value={l.account_id} onChange={setJLine(i, 'account_id')} required>
                          <option value="">— Select —</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                          ))}
                        </select>
                      </td>
                      <td><input type="number" step="0.01" min="0" value={l.debit} onChange={setJLine(i, 'debit')} /></td>
                      <td><input type="number" step="0.01" min="0" value={l.credit} onChange={setJLine(i, 'credit')} /></td>
                      <td><button type="button" className="btn btn-sm btn-danger" onClick={() => dropJLine(i)}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="right"><strong>Totals</strong></td>
                    <td className="right nowrap"><strong>{inr(jDr)}</strong></td>
                    <td className="right nowrap"><strong>{inr(jCr)}</strong></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div className="mt flex">
                <button type="button" className="btn btn-sm" onClick={addJLine}>+ Add Line</button>
                <span style={{ margin: '0 12px', color: jBalanced ? 'var(--green)' : 'var(--red)' }}>{jBalanced ? 'Balanced ✓' : 'Debits and credits must match'}</span>
                <button className="btn btn-primary" type="submit" disabled={!jBalanced}>Post Voucher</button>
              </div>
            </form>

            <div className="card-title"><span>Journal Register</span></div>
            {journal.length === 0 ? (
              <div className="empty">No journal vouchers.</div>
            ) : (
              journal.map((j) => (
                <div key={j.id} className="mb" style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 12 }}>
                  <div className="flex" style={{ justifyContent: 'space-between' }}>
                    <strong>{j.voucher_no}</strong>
                    <span>{j.voucher_date}</span>
                    <span style={{ flex: 1, marginLeft: 12 }}>{j.narration}</span>
                    <span className="badge">{j.source}</span>
                    {j.source === 'JOURNAL' && j.status === 'POSTED' && (
                      <button className="btn btn-sm btn-danger" onClick={() => voidJournal(j.id)}>Void</button>
                    )}
                  </div>
                  <table>
                    <thead>
                      <tr><th>Account</th><th className="right">Debit</th><th className="right">Credit</th></tr>
                    </thead>
                    <tbody>
                      {(j.legs || []).map((l, idx) => (
                        <tr key={idx}>
                          <td>{l.account_code} - {l.account_name}</td>
                          <td className="right nowrap">{Number(l.debit) ? inr(l.debit) : ''}</td>
                          <td className="right nowrap">{Number(l.credit) ? inr(l.credit) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            )}
          </>
        )}

        {tab === 'Ledger' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>Account</label>
                  <select value={naAccountId} onChange={(e) => setNaAccountId(e.target.value)}>
                    <option value="">— Select —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>From</label>
                  <input type="date" value={naFrom} onChange={(e) => setNaFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To</label>
                  <input type="date" value={naTo} onChange={(e) => setNaTo(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadLedger}>Load</button>
              </div>
            </div>
            {lg && (
              <>
                <div className="stats-grid">
                  <div className="stat-card"><div className="label">Opening</div><div className="value">{inr(lg.openingBalance)}</div></div>
                  <div className="stat-card"><div className="label">Closing</div><div className="value">{inr(lg.closingBalance)}</div></div>
                  <div className="stat-card"><div className="label">Entries</div><div className="value">{lg.entries.length}</div></div>
                </div>
                {lg.entries.length === 0 ? (
                  <div className="empty">No ledger entries in this period.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th><th>Voucher</th><th>Narration</th>
                        <th className="right">Debit</th><th className="right">Credit</th><th className="right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lg.entries.map((t) => (
                        <tr key={t.id}>
                          <td className="nowrap">{t.date}</td>
                          <td className="nowrap">{t.voucher_no}</td>
                          <td>{t.narration}</td>
                          <td className="right nowrap">{Number(t.debit) ? inr(t.debit) : ''}</td>
                          <td className="right nowrap">{Number(t.credit) ? inr(t.credit) : ''}</td>
                          <td className="right nowrap">{inr(t.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </>
        )}

        {tab === 'Trial Balance' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>As of</label>
                  <input type="date" value={tbAsOf} onChange={(e) => setTbAsOf(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadTB}>Load</button>
                {tb && (
                  <span style={{ marginLeft: 12, color: tb.balanced ? 'var(--green)' : 'var(--red)' }}>
                    {tb.balanced ? 'Balanced ✓' : 'NOT BALANCED'}
                  </span>
                )}
              </div>
            </div>
            {tb && (
              <>
                <div className="stats-grid">
                  <div className="stat-card"><div className="label">Total Debits</div><div className="value">{inr(tb.totals.debit)}</div></div>
                  <div className="stat-card"><div className="label">Total Credits</div><div className="value">{inr(tb.totals.credit)}</div></div>
                  <div className="stat-card"><div className="label">Status</div><div className="value" style={{ color: tb.balanced ? 'var(--green)' : 'var(--red)' }}>{tb.balanced ? 'Balanced' : 'Difference ' + inr(tb.totals.debit - tb.totals.credit)}</div></div>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Code</th><th>Account</th><th>Type</th>
                      <th className="right">Debit</th><th className="right">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tb.items.map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">{r.code}</td>
                        <td>{r.name}</td>
                        <td>{r.type}</td>
                        <td className="right nowrap">{Number(r.debit) ? inr(r.debit) : ''}</td>
                        <td className="right nowrap">{Number(r.credit) ? inr(r.credit) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td></td><td colSpan={2}><strong>Totals</strong></td>
                      <td className="right nowrap"><strong>{inr(tb.totals.debit)}</strong></td>
                      <td className="right nowrap"><strong>{inr(tb.totals.credit)}</strong></td>
                    </tr>
                  </tfoot>
                </table>
              </>
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
                {pl?.source === 'ledger' && <span className="badge" style={{ marginLeft: 12 }}>From Ledger</span>}
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
                {bs?.source === 'ledger' && <span className="badge" style={{ marginLeft: 12 }}>From Ledger</span>}
              </div>
            </div>
            {bs && (
              <div className="stats-grid">
                <div className="stat-card"><div className="label">Total Assets</div><div className="value">{inr(bs.totalAssets)}</div></div>
                <div className="stat-card"><div className="label">Total Liabilities</div><div className="value">{inr(bs.totalLiabilities)}</div></div>
                <div className="stat-card"><div className="label">Inventory Value</div><div className="value">{inr(bs.inventoryValue)}</div></div>
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

        {tab === 'Cash & Bank' && (
          <>
            <div className="card-title">
              <div className="row">
                <div className="field">
                  <label>Account</label>
                  <select value={cbAccountId} onChange={(e) => setCbAccountId(e.target.value)}>
                    <option value="">— Select —</option>
                    {accounts.filter((a) => a.code === '1000' || a.code === '1100' || a.type === 'ASSET').map((a) => (
                      <option key={a.id} value={a.id}>{a.code} - {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>From</label>
                  <input type="date" value={cbFrom} onChange={(e) => setCbFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To</label>
                  <input type="date" value={cbTo} onChange={(e) => setCbTo(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={loadCB}>Load</button>
              </div>
            </div>
            {cb && (
              <>
                <div className="stats-grid">
                  <div className="stat-card"><div className="label">Opening</div><div className="value">{inr(cb.openingBalance)}</div></div>
                  <div className="stat-card"><div className="label">Closing</div><div className="value">{inr(cb.closingBalance)}</div></div>
                </div>
                {cb.entries.length === 0 ? (
                  <div className="empty">No cash/bank entries in this period.</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th><th>Voucher</th><th>Narration</th>
                        <th className="right">Receipts (Dr)</th><th className="right">Payments (Cr)</th><th className="right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cb.entries.map((t) => (
                        <tr key={t.id}>
                          <td className="nowrap">{t.date}</td>
                          <td className="nowrap">{t.voucher_no}</td>
                          <td>{t.narration}</td>
                          <td className="right nowrap">{Number(t.debit) ? inr(t.debit) : ''}</td>
                          <td className="right nowrap">{Number(t.credit) ? inr(t.credit) : ''}</td>
                          <td className="right nowrap">{inr(t.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
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

        {tab === 'Chart of Accounts' && (
          <>
            <div className="card-title">
              <div className="flex">
                <span>Chart of Accounts</span>
                <span className="badge">{accounts.length} accounts</span>
              </div>
            </div>

            <form onSubmit={submitAccount} className="mb">
              <div className="grid-3">
                <div className="field">
                  <label>Code</label>
                  <input value={acctForm.code} onChange={setAcct('code')} placeholder="e.g. 1201" required />
                </div>
                <div className="field">
                  <label>Name</label>
                  <input value={acctForm.name} onChange={setAcct('name')} placeholder="e.g. Cash - Petty" required />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={acctForm.type} onChange={setAcct('type')}>
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Parent</label>
                  <select value={acctForm.parent_id} onChange={setAcct('parent_id')}>
                    <option value="">— None —</option>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Opening Balance</label>
                  <input type="number" step="0.01" value={acctForm.opening_balance} onChange={setAcct('opening_balance')} />
                </div>
                <div className="field">
                  <label>Active</label>
                  <select value={acctForm.is_active ? 1 : 0} onChange={(e) => setAcctForm((f) => ({ ...f, is_active: e.target.value === '1' }))}>
                    <option value="1">Yes</option>
                    <option value="0">No</option>
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" type="submit">+ Add Account</button>
            </form>

            <table>
              <thead>
                <tr>
                  <th>Code</th><th>Name</th><th>Type</th><th>Parent</th>
                  <th className="right">Opening</th><th className="right">Ledger Balance</th>
                  <th>Active</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="nowrap">{a.code}</td>
                    <td>{a.name}</td>
                    <td>{a.type}</td>
                    <td>
                      {accounts.find((p) => p.id === a.parent_id)
                        ? `${accounts.find((p) => p.id === a.parent_id).code} - ${accounts.find((p) => p.id === a.parent_id).name}`
                        : '—'}
                    </td>
                    <td className="right nowrap">{inr(a.opening_balance)}</td>
                    <td className="right nowrap">{inr(a.balance)}</td>
                    <td>{Number(a.is_active) === 1 ? 'Yes' : 'No'}</td>
                    <td className="nowrap">
                      <button className="btn btn-sm" onClick={() => toggleAccount(a)}>{Number(a.is_active) === 1 ? 'Deactivate' : 'Activate'}</button>
                      <button className="btn btn-sm btn-danger" onClick={() => deleteAccount(a)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </>
  );
}