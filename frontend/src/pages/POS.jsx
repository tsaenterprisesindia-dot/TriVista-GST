import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import PaymentSplit from '../components/PaymentSplit';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const HELD_KEY = 'pos_held_bills_v1';

function loadHeld() {
  try {
    const raw = localStorage.getItem(HELD_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export default function POS() {
  const [products, setProducts] = useState([]);
  const [grid, setGrid] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [company, setCompany] = useState(null);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [payRows, setPayRows] = useState([]);
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState('');
  const [flash, setFlash] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wholesale, setWholesale] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [held, setHeld] = useState(loadHeld);
  const [showHeld, setShowHeld] = useState(false);
  const searchRef = useRef(null);
  const flashTimer = useRef(null);

  useEffect(() => {
    api.get('/products?limit=300').then((d) => {
      setProducts(d.data || []);
      setGrid(d.data || []);
    }).catch((e) => setError(e.message));
    api.get('/customers?limit=100').then((d) => setCustomers(d.data || [])).catch(() => {});
    api.get('/company').then((d) => setCompany(d)).catch(() => {});
  }, []);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setGrid(products);
      return;
    }
    const timer = setTimeout(() => {
      api.get(`/products?q=${encodeURIComponent(term)}&limit=60`)
        .then((d) => setGrid(d.data || []))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [search, products]);

  useEffect(() => {
    try {
      localStorage.setItem(HELD_KEY, JSON.stringify(held));
    } catch {
      /* storage unavailable */
    }
  }, [held]);

  useEffect(() => setHighlight(0), [grid, search]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const showFlash = (msg) => {
    setFlash(msg);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(''), 3000);
  };

  const visible = grid.filter(
    (p) =>
      !search.trim() ||
      (p.name || '').toLowerCase().includes((search || '').toLowerCase()) ||
      (p.sku || '').toLowerCase().includes((search || '').toLowerCase()) ||
      (p.barcode || '').toLowerCase().includes((search || '').toLowerCase())
  );

  const addItem = (p) => {
    const rate = Number(wholesale ? p.wholesale_price || p.selling_price : p.selling_price) || 0;
    setItems((prev) => {
      const hit = prev.find((i) => i.product_id === p.id);
      if (hit) {
        return prev.map((i) => (i.product_id === p.id ? { ...i, quantity: r2(i.quantity + 1) } : i));
      }
      return [
        ...prev,
        {
          product_id: p.id, item_name: p.name, hsn_code: p.hsn_code, gst_rate: Number(p.gst_rate) || 0,
          cess_rate: Number(p.cess_rate) || 0,
          quantity: 1, unit_price: rate, discount: 0,
        },
      ];
    });
  };

  const setQty = (idx, q) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(0, Number(q) || 0) } : it)));

  const setDisc = (idx, d) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, discount: Math.max(0, Number(d) || 0) } : it)));

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const bumpLast = (delta) =>
    setItems((prev) => {
      const last = prev.length - 1;
      if (last < 0) return prev;
      return prev.map((it, i) => {
        if (i !== last) return it;
        const q = Math.max(0, r2((Number(it.quantity) || 0) + delta));
        return { ...it, quantity: q };
      });
    });

  const removeLast = () => setItems((prev) => prev.slice(0, -1));

  const calc = useMemo(() => {
    const cust = customers.find((c) => String(c.id) === String(customerId));
    const coState = String(company?.state_code || '29');
    const posIsInterstate = !!cust?.state_code && String(cust.state_code) !== coState;
    const posIsUt = ['04','26','34','38'].includes(coState);
    let subtotal = 0, discount = 0, taxable = 0, tax = 0, cgst = 0, sgst = 0, utgst = 0, igst = 0, cess = 0;
    items.forEach((it) => {
      const gross = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
      const disc = Math.max(0, Number(it.discount) || 0);
      const tv = Math.max(0, gross - disc);
      subtotal += gross;
      discount += disc;
      taxable += tv;
      const t = (tv * (Number(it.gst_rate) || 0)) / 100;
      const cs = (tv * (Number(it.cess_rate) || 0)) / 100;
      if (posIsInterstate) { igst += r2(t); cgst += 0; sgst += 0; utgst += 0; }
      else if (posIsUt) { cgst += r2(t / 2); utgst += r2(t / 2); sgst += 0; igst += 0; }
      else { cgst += r2(t / 2); sgst += r2(t / 2); utgst += 0; igst += 0; }
      cess += r2(cs);
      tax += r2(t + cs);
    });
    return {
      subtotal: r2(subtotal),
      discount: r2(discount),
      taxable: r2(taxable),
      tax: r2(tax),
      cgst: r2(cgst),
      sgst: r2(sgst),
      utgst: r2(utgst),
      igst: r2(igst),
      cess: r2(cess),
      grand: r2(taxable + tax),
    };
  }, [items, customerId, customers, company]);

  const target = r2(Number(company?.round_off) === 1 ? Math.round(calc.grand) : calc.grand);
  const roundOff = r2(target - calc.grand);
  const payTotal = r2(
    (Array.isArray(payRows) ? payRows : []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
  );

  const placeSale = async () => {
    if (!items.length) return;
    setError('');
    setReceipt(null);
    setBusy(true);
    const rows = (Array.isArray(payRows) ? payRows : []).filter((r) => r && Number(r.amount) > 0);
    const payments = rows.length
      ? rows.map((r) => ({
          mode: r.mode || 'CASH',
          amount: Number(r.amount),
          reference_no: r.reference_no || null,
        }))
      : [{ mode: 'CASH', amount: target }];
    if (rows.length && Math.abs(payTotal - target) > 0.01) {
      setBusy(false);
      setError(`Payment split total (${payTotal}) does not match bill total (${target}).`);
      return;
    }
    try {
      const d = await api.post('/pos/sale', {
        customer_id: customerId || null,
        payment_mode: payments[0].mode,
        payments,
        items: items.map((it) => ({
          product_id: it.product_id,
          item_name: it.item_name,
          hsn_code: it.hsn_code,
          gst_rate: it.gst_rate,
          cess_rate: it.cess_rate || 0,
          quantity: it.quantity,
          unit: 'PCS',
          unit_price: it.unit_price,
          discount: it.discount,
        })),
      });
      setReceipt(d);
      setItems([]);
      setPayRows([]);
      setHighlight(0);
      searchRef.current?.focus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const hold = () => {
    if (!items.length) return showFlash('Nothing to hold.');
    const bill = {
      id: Date.now(),
      label: `Held ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`,
      customerId,
      customerName: customers.find((c) => String(c.id) === String(customerId))?.name || 'Walk-in Customer',
      payRows,
      items,
    };
    setHeld((prev) => [...prev, bill]);
    setItems([]);
    setPayRows([]);
    setCustomerId('');
    setShowHeld(true);
    showFlash(`Bill held (${items.length} item${items.length === 1 ? '' : 's'}).`);
  };

  const resume = (id) => {
    const bill = held.find((b) => b.id === id);
    if (!bill) return;
    setItems(bill.items || []);
    setCustomerId(bill.customerId || '');
    setPayRows(bill.payRows || []);
    setHeld((prev) => prev.filter((b) => b.id !== id));
    setShowHeld(false);
    showFlash(`Resumed: ${bill.label}`);
    searchRef.current?.focus();
  };

  const deleteHeld = (id) =>
    setHeld((prev) => prev.filter((b) => b.id !== id));

  const onSearchKey = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const m = visible[Math.min(highlight, visible.length - 1)];
      if (!m) return;
      addItem(m);
      const term = search.trim().toLowerCase();
      if (term && (String(m.barcode || '').toLowerCase() === term || String(m.sku || '').toLowerCase() === term)) {
        setSearch('');
      }
      setHighlight(0);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (visible.length) setHighlight((h) => Math.min(visible.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    }
  };

  useEffect(() => {
    const handler = (e) => {
      const t = e.target;
      const editable = t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');
      const k = e.key;
      if (k === 'F2' || ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') || (k === '/' && !editable)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (k === 'F3') { e.preventDefault(); setWholesale((w) => !w); return; }
      if (k === 'F4') { e.preventDefault(); hold(); return; }
      if (k === 'F8') {
        e.preventDefault();
        if (held.length) resume(held[held.length - 1].id);
        else showFlash('No held bills.');
        return;
      }
      if (k === 'F6') { e.preventDefault(); placeSale(); return; }
      if (k === 'Escape') {
        if (receipt) { e.preventDefault(); setReceipt(null); return; }
        if (showHeld) { e.preventDefault(); setShowHeld(false); return; }
        e.preventDefault();
        return;
      }
      if (editable) return;
      if (k === 'ArrowDown') { e.preventDefault(); if (visible.length) setHighlight((h) => Math.min(visible.length - 1, h + 1)); return; }
      if (k === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); return; }
      if (k === 'Enter') {
        e.preventDefault();
        const m = visible[Math.min(highlight, visible.length - 1)];
        if (m) addItem(m);
        return;
      }
      if (k === '+' || k === '=') { e.preventDefault(); bumpLast(1); return; }
      if (k === '-' || k === '_') { e.preventDefault(); bumpLast(-1); return; }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); removeLast(); return; }
      if (k === '?') { e.preventDefault(); window.open('/pos/shortcuts', '_blank'); return; }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  });

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {flash && <div className="success-banner">{flash}</div>}

      {receipt && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px', textAlign: 'center' }}>
          <div className="card-title" style={{ justifyContent: 'center' }}>SALE COMPLETED</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{inr(receipt.invoice.grand_total)}</div>
          <div className="muted">{receipt.invoice.invoice_number}</div>
          <div className="mt">Total GST: {inr(receipt.invoice.tax_total)}</div>
          <div className="mt flex" style={{ justifyContent: 'center' }}>
            <button className="btn" onClick={() => window.print()}>Print Receipt</button>
            <button className="btn btn-primary" onClick={() => setReceipt(null)}>New Sale</button>
          </div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Products</div>
          <div className="flex mb">
            <input
              ref={searchRef}
              placeholder="Search products / barcode / SKU — scan or type, then Enter"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKey}
              style={{ flex: 1 }}
              autoFocus
            />
            <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={wholesale} onChange={(e) => setWholesale(e.target.checked)} style={{ width: 'auto' }} />
              Wholesale (F3)
            </label>
          </div>

          <div className="flex mb" style={{ justifyContent: 'space-between', fontSize: 12 }}>
            <span className="muted" style={{ whiteSpace: 'nowrap' }}>
              {held.length > 0 ? `${held.length} held bill${held.length === 1 ? '' : 's'}` : 'No held bills'}
            </span>
            <button className="btn btn-sm" onClick={() => setShowHeld((s) => !s)}>
              {showHeld ? 'Hide' : 'Held Bills'} (F4 hold · F8 resume)
            </button>
          </div>

          {showHeld && held.length > 0 && (
            <div className="card" style={{ padding: 8, marginBottom: 10 }}>
              {[...held].reverse().map((b) => (
                <div key={b.id} className="flex" style={{ justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  <span>
                    <b>{b.label}</b>
                    <span className="muted"> · {b.items.length} item{b.items.length === 1 ? '' : 's'} · {inr(b.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0), 0))} · {b.customerName}</span>
                  </span>
                  <span className="flex">
                    <button className="btn btn-sm btn-primary" onClick={() => resume(b.id)}>Resume</button>
                    <button className="btn btn-sm btn-danger" onClick={() => deleteHeld(b.id)}>×</button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {visible.length === 0 ? (
            <div className="empty">No products match. Try scanning the barcode or a different name/SKU.</div>
          ) : (
            <div className="stats-grid">
              {visible.slice(0, 60).map((p, i) => (
                <button
                  type="button"
                  className="btn"
                  key={p.id}
                  onClick={() => addItem(p)}
                  style={{
                    justifyContent: 'space-between',
                    outline: i === highlight ? '2px solid var(--primary)' : undefined,
                  }}
                >
                  <span>{p.name}</span>
                  <span className="muted nowrap">
                    {p.wholesale_price ? (wholesale ? inr(p.wholesale_price) : `${inr(p.selling_price)} / ${inr(p.wholesale_price)}w`) : inr(p.selling_price)}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Shortcuts: <b>F2</b> search · <b>↑↓+Enter</b> add · <b>+/-</b> qty · <b>F3</b> wholesale · <b>F4</b> hold · <b>F8</b> resume · <b>F6</b> charge
            <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => window.open('/pos/shortcuts', '_blank')}>Shortcuts page (? or print)</button>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Cart (POS)</div>
          <div className="row mb">
            <div>
              <label>Customer</label>
              <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Walk-in Customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {items.length > 0 && (
            <PaymentSplit
              total={target}
              value={payRows}
              onChange={setPayRows}
              withReference
              label="Payment split"
            />
          )}

          {items.length === 0 ? (
            <div className="empty">Tap products or scan barcodes to add to the cart. F4 holds, F6 charges.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Qty</th>
                  <th className="right">Rate</th>
                  <th className="right">Disc</th>
                  <th className="right">GST%</th>
                  <th className="right">Cess%</th>
                  <th className="right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td>{it.item_name}</td>
                    <td className="right">
                      <input type="number" min="0" step="any" value={it.quantity} onChange={(e) => setQty(idx, e.target.value)} style={{ width: 60, textAlign: 'right' }} />
                    </td>
                    <td className="right nowrap">{inr(it.unit_price)}</td>
                    <td className="right">
                      <input type="number" min="0" step="any" value={it.discount ?? 0} onChange={(e) => setDisc(idx, e.target.value)} style={{ width: 60, textAlign: 'right' }} />
                    </td>
                    <td className="right">{it.gst_rate}%</td>
                    <td className="right">{+it.cess_rate > 0 ? `${it.cess_rate}%` : '–'}</td>
                    <td className="right nowrap">
                      {inr(Math.max(0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) - (Number(it.discount) || 0)))}
                    </td>
                    <td className="right"><button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="row mt"><div className="muted">Subtotal</div><div className="right nowrap">{inr(calc.subtotal)}</div></div>
          {calc.discount > 0 && <div className="row"><div className="muted">Discount</div><div className="right nowrap">− {inr(calc.discount)}</div></div>}
          <div className="row"><div className="muted">Taxable</div><div className="right nowrap">{inr(calc.taxable)}</div></div>
          <div className="row">
            <div className="muted">
              {calc.cgst > 0 ? (calc.utgst > 0 ? `GST (CGST ${inr(calc.cgst)} + UTGST ${inr(calc.utgst)})` : calc.igst > 0 ? `IGST ${inr(calc.igst)} (interstate)` : `GST (CGST ${inr(calc.cgst)} + SGST ${inr(calc.sgst)})`) : `IGST ${inr(calc.igst)} (interstate)`}
            </div>
            <div className="right nowrap">{inr(calc.igst || (calc.cgst + calc.sgst + calc.utgst))}</div>
          </div>
          {calc.cess > 0 && (
            <div className="row"><div className="muted">Compensation Cess</div><div className="right nowrap">{inr(calc.cess)}</div></div>
          )}
          {roundOff !== 0 && (
            <div className="row"><div className="muted">Round off</div><div className="right nowrap">{inr(roundOff)}</div></div>
          )}
          <div className="row" style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
            <div>Total</div><div className="right nowrap">{inr(target)}</div>
          </div>

          <div className="mt flex" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setItems([])} disabled={items.length === 0}>Clear</button>
            <button className="btn" onClick={hold} disabled={items.length === 0}>Hold (F4)</button>
            <button className="btn btn-primary" onClick={placeSale} disabled={busy || items.length === 0}>
              {busy ? 'Processing…' : `Charge ${inr(target)} (F6)`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}