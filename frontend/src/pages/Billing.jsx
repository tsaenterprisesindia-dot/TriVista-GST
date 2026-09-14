import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import PaymentSplit from '../components/PaymentSplit';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(n) || 0);

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function Billing() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [company, setCompany] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [ai, setAi] = useState(null);
  const [wholesale, setWholesale] = useState(false);
  const [sac, setSac] = useState([]);
  const [sacSearch, setSacSearch] = useState('');

  const [form, setForm] = useState(() => ({
    customer_id: '',
    invoice_type: '',
    invoice_date: new Date().toISOString().slice(0, 10),
    due_date: '',
    payment_mode: 'CREDIT',
    paid_amount: 0,
    payments: [],
    notes: '',
    items: [],
  }));
  const [allowBackdate, setAllowBackdate] = useState(false);

  useEffect(() => {
    api.get('/customers?limit=100').then((d) => setCustomers(d.data || [])).catch(() => {});
    api.get('/products?limit=200').then((d) => setProducts(d.data || [])).catch(() => {});
    api.get('/company').then((d) => {
      setCompany(d);
      if (d.business_type === 'wholesale') setWholesale(true);
    }).catch(() => {});
    api.get('/hsn?type=SAC').then((d) => setSac(d || [])).catch(() => {});
  }, []);

  const customer = customers.find((c) => String(c.id) === String(form.customer_id));
  const companyState = company?.state_code || '29';
  const supplyState = form.place_of_supply || customer?.state_code || companyState;
  const isInterstate = String(supplyState) !== String(companyState);

  const localToday = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const isBackdated = form.invoice_date !== localToday();
  const needsEinvoice = !!company?.e_invoice_enabled && Number(company?.aggregate_turnover_crores || 0) >= 5 && !!customer?.gstin;

  const visibleProducts = products.filter(
    (p) => !search || (p.name || '').toLowerCase().includes(search.toLowerCase()) || (p.sku || '').toLowerCase().includes(search.toLowerCase())
  );
  const isUt = ['04','26','38'].includes(String(companyState));
  const visibleSac = sac.filter(
    (s) => sacSearch && (
      (s.code || '').toLowerCase().includes(sacSearch.toLowerCase()) ||
      (s.description || '').toLowerCase().includes(sacSearch.toLowerCase())
    )
  );
  const addSacCode = (h) => {
    setSacSearch('');
    setForm((f) => ({
      ...f,
      items: [...f.items, {
        product_id: null,
        item_name: h.description || h.code,
        hsn_code: h.code,
        gst_rate: Number(h.gst_rate) || 0,
        quantity: 1,
        unit_price: 0,
        discount: 0,
      }],
    }));
  };

  const addItem = (p) => {
    setForm((f) => {
      const hit = f.items.find((i) => i.product_id === p.id);
      if (hit) {
        return { ...f, items: f.items.map((i) => (i.product_id === p.id ? { ...i, quantity: r2(i.quantity + 1) } : i)) };
      }
      const rate = wholesale ? Number(p.wholesale_price || p.selling_price) : Number(p.selling_price);
      return {
        ...f,
        items: [
          ...f.items,
          {
            product_id: p.id,
            item_name: p.name,
            hsn_code: p.hsn_code,
            gst_rate: Number(p.gst_rate) || 0,
            quantity: 1,
            unit_price: rate,
            discount: 0,
          },
        ],
      };
    });
  };

  const setItem = (idx, key) => (e) => {
    setForm((f) => {
      const items = f.items.map((it, i) => (i === idx ? { ...it, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value } : it));
      return { ...f, items };
    });
  };

  const removeItem = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const isCreditDoc = form.invoice_type === 'CREDIT_NOTE' || form.invoice_type === 'DEBIT_NOTE';
  const calc = useMemo(() => {
    const docSign = isCreditDoc ? -1 : 1;
    let subtotal = 0, discount = 0, cgst = 0, sgst = 0, utgst = 0, igst = 0, tax = 0, grand = 0;
    const detail = form.items.map((it) => {
      const gross = it.quantity * it.unit_price;
      let taxable = gross - (it.discount || 0);
      let cg = 0, sg = 0, ug = 0, ig = 0;
      const isNil = form.invoice_type === 'NIL';
      const isExport = form.invoice_type === 'EXPORT';
      if (isNil) taxable = 0;
      else if (!isExport) {
        if (isInterstate) ig = r2((taxable * it.gst_rate) / 100);
        else if (isUt) { cg = r2((taxable * it.gst_rate) / 200); ug = r2((taxable * it.gst_rate) / 200); }
        else { cg = r2((taxable * it.gst_rate) / 200); sg = r2((taxable * it.gst_rate) / 200); }
      }
      subtotal += gross * docSign;
      discount += (it.discount || 0) * docSign;
      cgst += cg * docSign; sgst += sg * docSign; utgst += ug * docSign; igst += ig * docSign;
      tax += (cg + sg + ug + ig) * docSign;
      grand += (taxable + cg + sg + ug + ig) * docSign;
      return { ...it, taxable: r2(taxable * docSign), cg: cg * docSign, sg: sg * docSign, ug: ug * docSign, ig: ig * docSign, line: r2((taxable + cg + sg + ug + ig) * docSign) };
    });
    return { detail, subtotal: r2(subtotal), discount: r2(discount), cgst: r2(cgst), sgst: r2(sgst), utgst: r2(utgst), igst: r2(igst), tax: r2(tax), grand: r2(grand) };
  }, [form.items, isInterstate, isCreditDoc, form.invoice_type, isUt]);

  const payload = () => {
    const payRows = (form.payments || []).filter((p) => p && Number(p.amount) > 0);
    return {
      customer_id: form.customer_id,
      customer_gstin: customer?.gstin || '',
      invoice_type: form.invoice_type || undefined,
      place_of_supply: supplyState,
      is_interstate: isInterstate,
      invoice_date: form.invoice_date,
      due_date: form.due_date || null,
      payment_mode: payRows.length ? payRows[0].mode : form.payment_mode,
      paid_amount: payRows.length ? r2(payRows.reduce((s, p) => s + (Number(p.amount) || 0), 0)) : Number(form.paid_amount) || 0,
      payments: payRows.length
        ? payRows.map((p) => ({ mode: p.mode, amount: Number(p.amount), reference_no: p.reference_no || null }))
        : undefined,
      notes: form.notes || null,
      allow_backdate: isBackdated ? allowBackdate : undefined,
      items: form.items.map((it) => ({
        product_id: it.product_id,
        item_name: it.item_name,
        hsn_code: it.hsn_code,
        gst_rate: it.gst_rate,
        quantity: it.quantity,
        unit: 'PCS',
        unit_price: it.unit_price,
        discount: it.discount || 0,
      })),
    };
  };

  const runAiCheck = async () => {
    setError('');
    setAiBusy(true);
    setAi(null);
    try {
      setAi(await api.post('/ai/validate', payload()));
    } catch (err) {
      setError(err.message);
    } finally {
      setAiBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setAi(null);
    setBusy(true);
    try {
      if (isBackdated && !allowBackdate) {
        setError('This invoice is backdated. Confirm the date in the warning box above to proceed.');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const v = await api.post('/ai/validate', payload());
      if (v.issues.some((x) => x.level === 'error')) {
        setAi(v);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setError('AI check found errors below. Fix them, then save again.');
        return;
      }
      const d = await api.post('/invoices', payload());
      navigate(`/invoices/${d.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      {error && <div className="error-banner">{error}</div>}

      {needsEinvoice && (
        <div className="banner-warn" style={{ border: '1px solid var(--amber)', background: '#fff8e6', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          e-Invoicing is enabled and this customer has a GSTIN — a valid IRN must be generated for this invoice
          via <Link to="/integration">e-Invoice / e-Way</Link> within 10 days.
        </div>
      )}

      {isBackdated && (
        <div className="banner-warn" style={{ border: '1px solid var(--amber)', background: '#fff8e6', padding: '10px 14px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          <strong>Backdated invoice:</strong> the date is earlier than today. Backdated entries are recorded in the
          audit trail. <label style={{ marginLeft: 10 }}><input type="checkbox" checked={allowBackdate} onChange={(e) => setAllowBackdate(e.target.checked)} style={{ width: 'auto' }} /> I confirm this date is correct</label>
        </div>
      )}

      {ai && (
        <div className="card" style={{ borderColor: ai.ok ? 'var(--green)' : 'var(--amber)' }}>
          <div className="card-title">
            <span>Smart Entry Check (free built-in AI)</span>
            {ai.ok ? <span className="badge badge-green">OK</span> : <span className="badge badge-amber">Review</span>}
          </div>
          {ai.issues.length === 0 ? (
            <div className="muted">No issues found — this entry looks correct.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ai.issues.map((it, idx) => (
                <li key={idx} className="mb">
                  <span className={`badge ${it.level === 'error' ? 'badge-red' : 'badge-amber'}`}>{it.level.toUpperCase()}</span>{' '}
                  {it.message}
                </li>
              ))}
            </ul>
          )}
          {ai.suggestions.length > 0 && (
            <div className="muted mt" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {ai.suggestions.map((s) => `• ${s}`).join('\n')}
            </div>
          )}
          <div className="muted mt">AI-computed grand total: <strong>{inr(ai.grandTotal)}</strong></div>
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">Invoice Details</div>
          <div className="row">
            <div className="field">
              <label>Customer</label>
              <select value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} required>
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.company_name ? ` (${c.company_name})` : ''}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Invoice Date</label>
              <input type="date" value={form.invoice_date} onChange={(e) => setForm((f) => ({ ...f, invoice_date: e.target.value }))} required />
            </div>
          </div>
          <div className="field">
            <label>Document Type</label>
            <select value={form.invoice_type} onChange={(e) => setForm((f) => ({ ...f, invoice_type: e.target.value }))}>
              <option value="">Auto (from customer registration category)</option>
              <option value="B2B">B2B — Tax Invoice (customer has GSTIN)</option>
              <option value="B2C">B2C — Tax Invoice (no GSTIN)</option>
              <option value="CREDIT_NOTE">Credit Note (reduces sales)</option>
              <option value="DEBIT_NOTE">Debit Note (increases sales)</option>
              <option value="EXPORT">Export (0% GST, retains value)</option>
              <option value="NIL">Nil-Rated / Exempt (no tax or value)</option>
            </select>
            {(form.invoice_type === 'CREDIT_NOTE' || form.invoice_type === 'DEBIT_NOTE') && (
              <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                Credit/debit notes are stored with negative amounts so monthly/annual GST reports net them correctly.
              </div>
            )}
          </div>
          <div className="row">
          <div className="field">
            <label>Payment Mode</label>
            <select
              value={(form.payments || []).length ? (form.payments)[0].mode : form.payment_mode}
              onChange={(e) => {
                const m = e.target.value;
                if ((form.payments || []).length) {
                  setForm((f) => ({ ...f, payments: f.payments.map((p, i) => (i === 0 ? { ...p, mode: m } : p)) }));
                } else {
                  setForm((f) => ({ ...f, payment_mode: m }));
                }
              }}
            >
              <option value="CREDIT">Credit</option>
              <option value="CASH">Cash</option>
              <option value="CARD">Card</option>
              <option value="UPI">UPI</option>
              <option value="BANK">Bank Transfer</option>
            </select>
          </div>
          <div className="field">
            <label>Amount Paid Now (₹) — leave 0 for full credit</label>
            <input
              type="number" step="0.01" min="0"
              value={(form.payments || []).length ? '' : form.paid_amount}
              disabled={(form.payments || []).length > 0}
              placeholder={String(r2((form.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0)) || '0')}
              onChange={(e) => setForm((f) => ({ ...f, paid_amount: e.target.value }))}
            />
          </div>
        </div>
        <details style={{ marginTop: 2 }}>
          <summary className="muted" style={{ fontSize: 12, cursor: 'pointer' }}>Split payment (e.g. Cash + UPI)</summary>
          <div className="mt">
            <PaymentSplit
              total={calc.grand}
              value={form.payments || []}
              onChange={(rows) => setForm((f) => ({ ...f, payments: rows }))}
              withReference
              label="Split payment"
            />
          </div>
        </details>
          <div className="field">
            <label>Notes</label>
            <textarea rows="2" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Optional reference / remarks" />
          </div>
        </div>

        <div className="card">
          <div className="card-title">Supply</div>
          <div className="field">
            <label>Place of Supply (State Code)</label>
            <input value={customer?.state_code || ''} disabled placeholder="From customer state" />
          </div>
          <div className="field">
            <label>Tax Applied</label>
            <input value={isInterstate ? `IGST (cross-state vs ${company?.state || 'your state'})` : isUt ? `CGST + UTGST (${company?.state || 'your union territory'})` : `CGST + SGST (${company?.state || 'same state'})`} disabled />
          </div>
          {customer?.outstanding_balance > 0 && (
            <div className="badge badge-amber">Outstanding: {inr(customer.outstanding_balance)}</div>
          )}
          {customer?.credit_limit ? (
            (() => {
              const used = Number(customer.outstanding_balance) || 0;
              const remaining = r2(Number(customer.credit_limit) - used);
              const willExceed = remaining < calc.grand;
              return (
                <div className={willExceed ? 'badge badge-red' : 'badge badge-blue'} style={{ display: 'block', marginTop: 6 }}>
                  Credit limit {inr(customer.credit_limit)} · Used {inr(used)} · Left {inr(remaining)}
                  {willExceed && <div className="mt" style={{ color: 'inherit' }}>This invoice exceeds remaining credit by {inr(calc.grand - remaining)} — review before saving.</div>}
                </div>
              );
            })()
          ) : null}
          <div className="muted mt" style={{ fontSize: 12 }}>
              Invoice type: {form.invoice_type || (customer?.registration_category === 'unregistered' ? 'B2C' : 'B2B')} · GSTIN: {customer?.gstin || 'Not registered'}
            </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Products</span>
          <label className="muted" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={wholesale} onChange={(e) => setWholesale(e.target.checked)} style={{ width: 'auto' }} />
            Use wholesale prices
          </label>
        </div>
        <div className="field">
          <input placeholder="Search products by name or SKU…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {visibleProducts.length === 0 ? (
          <div className="empty">No products found. Add products first.</div>
        ) : (
          <div className="stats-grid">
            {visibleProducts.slice(0, 40).map((p) => (
              <button type="button" className="btn" key={p.id} onClick={() => addItem(p)} style={{ justifyContent: 'space-between' }}>
                <span>{p.name}</span>
                <span className="muted nowrap">
                  {p.wholesale_price ? `${inr(p.wholesale_price)} w / ${inr(p.selling_price)} r` : inr(p.selling_price)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="card-title mt" style={{ marginTop: 14 }}>Add by HSN / SAC code</div>
        <div className="field">
          <input placeholder="Search SAC / HSN codes (e.g. 9983 Professional Services)…" value={sacSearch} onChange={(e) => setSacSearch(e.target.value)} />
        </div>
        {visibleSac.length > 0 && (
          <div className="stats-grid">
            {visibleSac.slice(0, 30).map((h) => (
              <button type="button" className="btn" key={h.code} onClick={() => addSacCode(h)} style={{ justifyContent: 'space-between', textAlign: 'left' }}>
                <span>
                  <strong>{h.code}</strong>{h.type === 'SAC' ? ' · SAC' : ' · HSN'} · {h.gst_rate}%
                  <div className="muted" style={{ fontSize: 11.5 }}>{h.description}</div>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Line Items</div>
        {calc.detail.length === 0 ? (
          <div className="empty">Add products above to build the invoice.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>HSN</th>
                <th className="right">Qty</th>
                <th className="right">Rate</th>
                <th className="right">Disc</th>
                <th className="right">GST%</th>
                <th className="right">Taxable</th>
                <th className="right">CGST</th>
                <th className="right">{isUt ? 'UTGST' : 'SGST'}</th>
                <th className="right">IGST</th>
                <th className="right">Line</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {calc.detail.map((it, idx) => (
                <tr key={idx}>
                  <td><input value={it.item_name} onChange={setItem(idx, 'item_name')} style={{ width: 150 }} /></td>
                  <td><input value={it.hsn_code || ''} onChange={setItem(idx, 'hsn_code')} style={{ width: 70 }} /></td>
                  <td className="right"><input type="number" min="0" value={it.quantity} onChange={setItem(idx, 'quantity')} style={{ width: 60, textAlign: 'right' }} /></td>
                  <td className="right"><input type="number" min="0" step="0.01" value={it.unit_price} onChange={setItem(idx, 'unit_price')} style={{ width: 80, textAlign: 'right' }} /></td>
                  <td className="right"><input type="number" min="0" step="0.01" value={it.discount} onChange={setItem(idx, 'discount')} style={{ width: 70, textAlign: 'right' }} /></td>
                  <td className="right"><input type="number" min="0" step="0.01" value={it.gst_rate} onChange={setItem(idx, 'gst_rate')} style={{ width: 60, textAlign: 'right' }} /></td>
                  <td className="right nowrap">{inr(it.taxable)}</td>
                  <td className="right nowrap">{inr(it.cg)}</td>
                  <td className="right nowrap">{inr(isUt ? it.ug : it.sg)}</td>
                  <td className="right nowrap">{inr(it.ig)}</td>
                  <td className="right nowrap">{inr(it.line)}</td>
                  <td className="right"><button type="button" className="btn btn-sm btn-danger" onClick={() => removeItem(idx)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="row mt" style={{ maxWidth: 420, marginLeft: 'auto' }}>
          <div className="muted">Subtotal</div>
          <div className="right nowrap">{inr(calc.subtotal)}</div>
        </div>
        <div className="row" style={{ maxWidth: 420, marginLeft: 'auto' }}>
          <div className="muted">Discount</div>
          <div className="right nowrap">- {inr(calc.discount)}</div>
        </div>
        {calc.cgst > 0 && (
          <div className="row" style={{ maxWidth: 420, marginLeft: 'auto' }}>
            <div className="muted">CGST</div><div className="right nowrap">{inr(calc.cgst)}</div>
          </div>
        )}
        {calc.sgst > 0 && (
          <div className="row" style={{ maxWidth: 420, marginLeft: 'auto' }}>
            <div className="muted">{isUt ? 'UTGST' : 'SGST'}</div><div className="right nowrap">{inr(isUt ? calc.utgst : calc.sgst)}</div>
          </div>
        )}
        {calc.igst > 0 && (
          <div className="row" style={{ maxWidth: 420, marginLeft: 'auto' }}>
            <div className="muted">IGST</div><div className="right nowrap">{inr(calc.igst)}</div>
          </div>
        )}
        <div className="row" style={{ maxWidth: 420, marginLeft: 'auto', fontSize: 18, fontWeight: 700, marginTop: 6 }}>
          <div>Grand Total</div>
          <div className="right nowrap">{inr(calc.grand)}</div>
        </div>
      </div>

      <div className="flex" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn" onClick={runAiCheck} disabled={aiBusy || busy || form.items.length === 0 || !form.customer_id}>
          {aiBusy ? 'Checking…' : 'Smart Check (AI)'}
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || aiBusy || form.items.length === 0 || !form.customer_id}>
          {busy ? 'Saving…' : 'Save Invoice'}
        </button>
        <Link to="/invoices" className="btn">Cancel</Link>
      </div>
    </form>
  );
}