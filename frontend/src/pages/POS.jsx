import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function POS() {
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [customerId, setCustomerId] = useState('');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wholesale, setWholesale] = useState(false);

  useEffect(() => {
    api.get('/products?limit=300').then((d) => setProducts(d.data || [])).catch((e) => setError(e.message));
    api.get('/customers?limit=100').then((d) => setCustomers(d.data || [])).catch(() => {});
  }, []);

  const visible = products.filter(
    (p) => !search || (p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())
  );

  const addItem = (p) => {
    setItems((prev) => {
      const hit = prev.find((i) => i.product_id === p.id);
      if (hit) {
        return prev.map((i) => (i.product_id === p.id ? { ...i, quantity: r2(i.quantity + 1) } : i));
      }
      return [...prev, { product_id: p.id, item_name: p.name, hsn_code: p.hsn_code, gst_rate: Number(p.gst_rate) || 0, quantity: 1, unit_price: Number(wholesale ? p.wholesale_price || p.selling_price : p.selling_price) || 0 }];
    });
  };

  const setQty = (idx, q) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, quantity: Math.max(0, Number(q) || 0) } : it)));

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const calc = useMemo(() => {
    let subtotal = 0, tax = 0, cgst = 0, sgst = 0, igst = 0;
    items.forEach((it) => {
      subtotal += it.quantity * it.unit_price;
      const t = (it.quantity * it.unit_price * it.gst_rate) / 100;
      cgst += r2(t / 2);
      sgst += r2(t / 2);
      igst += r2(t);
      tax += r2(t);
    });
    const grand = r2(subtotal + tax);
    return { subtotal: r2(subtotal), tax: r2(tax), cgst: r2(cgst), sgst: r2(sgst), igst: r2(igst), grand };
  }, [items]);

  const placeSale = async () => {
    setError('');
    setReceipt(null);
    setBusy(true);
    try {
      const d = await api.post('/pos/sale', {
        customer_id: customerId || null,
        payment_mode: paymentMode,
        items: items.map((it) => ({ product_id: it.product_id, item_name: it.item_name, hsn_code: it.hsn_code, gst_rate: it.gst_rate, quantity: it.quantity, unit: 'PCS', unit_price: it.unit_price })),
      });
      setReceipt(d);
      setItems([]);
      setPaymentMode('CASH');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}

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
            <input placeholder="Search products / barcode / SKU" value={search} onChange={(e) => setSearch(e.target.value)} className="mb" style={{ marginBottom: 0, flex: 1 }} />
            <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={wholesale} onChange={(e) => setWholesale(e.target.checked)} style={{ width: 'auto' }} />
              Wholesale
            </label>
          </div>
          {visible.length === 0 ? (
            <div className="empty">No products match.</div>
          ) : (
            <div className="stats-grid">
              {visible.slice(0, 60).map((p) => (
                <button type="button" className="btn" key={p.id} onClick={() => addItem(p)} style={{ justifyContent: 'space-between' }}>
                  <span>{p.name}</span>
                  <span className="muted nowrap">{p.wholesale_price ? (wholesale ? inr(p.wholesale_price) : `${inr(p.selling_price)} / ${inr(p.wholesale_price)}w`) : inr(p.selling_price)}</span>
                </button>
              ))}
            </div>
          )}
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
            <div>
              <label>Payment Mode</label>
              <select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value)}>
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="UPI">UPI</option>
                <option value="BANK">Bank</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="empty">Tap products to add to the cart.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="right">Qty</th>
                  <th className="right">Rate</th>
                  <th className="right">GST%</th>
                  <th className="right">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => (
                  <tr key={idx}>
                    <td>{it.item_name}</td>
                    <td className="right"><input type="number" min="0" value={it.quantity} onChange={(e) => setQty(idx, e.target.value)} style={{ width: 60, textAlign: 'right' }} /></td>
                    <td className="right nowrap">{inr(it.unit_price)}</td>
                    <td className="right">{it.gst_rate}%</td>
                    <td className="right nowrap">{inr(it.quantity * it.unit_price)}</td>
                    <td className="right"><button className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="row mt"><div className="muted">Subtotal</div><div className="right nowrap">{inr(calc.subtotal)}</div></div>
          <div className="row"><div className="muted">GST (CGST {inr(calc.cgst)} + SGST {inr(calc.sgst)})</div><div className="right nowrap">{inr(calc.tax)}</div></div>
          <div className="row" style={{ fontSize: 20, fontWeight: 700, marginTop: 6 }}>
            <div>Total</div><div className="right nowrap">{inr(calc.grand)}</div>
          </div>

          <div className="mt flex" style={{ justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setItems([])} disabled={items.length === 0}>Clear</button>
            <button className="btn btn-primary" onClick={placeSale} disabled={busy || items.length === 0}>
              {busy ? 'Processing…' : `Charge ${inr(calc.grand)}`}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}