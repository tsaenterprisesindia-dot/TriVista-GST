import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const PLAN_TYPES = [
  ['TRIAL', 'Free Trial'],
  ['SUBSCRIPTION', 'Subscription'],
  ['ONETIME', 'One-Time'],
  ['LIFETIME', 'Lifetime'],
];
const PLAN_TYPE_LABEL = Object.fromEntries(PLAN_TYPES);

const MODEL_LABEL = { general: 'General', manufacturing: 'Manufacturing', import_export: 'Import/Export' };

const PLAN_FEATURES = [
  { key: 'distribution', label: 'Routes / Beats' },
  { key: 'consignment', label: 'Consignment' },
  { key: 'agency', label: 'Agency Commission' },
  { key: 'priceLists', label: 'Customer Price Lists' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'loyalty', label: 'Loyalty Points' },
  { key: 'outreach', label: 'Receipts via WhatsApp/SMS/Email' },
  { key: 'bom', label: 'BOM' },
  { key: 'workOrders', label: 'Work Orders' },
  { key: 'jobWork', label: 'Job Work' },
  { key: 'costing', label: 'Costing' },
  { key: 'tradeMasters', label: 'IEC / LUT / Currency' },
  { key: 'multiCurrency', label: 'Multi-Currency' },
  { key: 'exportDocs', label: 'Export Docs Chain' },
  { key: 'exportGst', label: 'GSTR-1 6A / Refund' },
];

const LICENSE_STATUSES = [
  ['TRIAL', 'Trial', 'badge-blue'],
  ['ACTIVE', 'Active', 'badge-green'],
  ['PAST_DUE', 'Past Due', 'badge-red'],
  ['EXPIRED', 'Expired', 'badge-red'],
  ['CANCELLED', 'Cancelled', 'badge-gray'],
];
const STATUS_LABEL = Object.fromEntries(LICENSE_STATUSES.map(([v, l]) => [v, l]));
const STATUS_BADGE = Object.fromEntries(LICENSE_STATUSES.map(([v, l, b]) => [v, b]));

const PAY_LABEL = { UNPAID: 'Unpaid', PARTIAL: 'Partial', PAID: 'Paid' };
const PAY_BADGE = { UNPAID: 'badge-gray', PARTIAL: 'badge-amber', PAID: 'badge-green' };

const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const emptyPlan = { name: '', type: 'SUBSCRIPTION', duration_days: '30', price: '', seats: '1', is_active: 1, business_model: 'general', features: {} };
const emptyLic = {
  client_name: '', contact_person: '', phone: '', email: '', gstin: '',
  plan_id: '', start_date: new Date().toISOString().slice(0, 10), status: 'TRIAL',
  seats: '', amount: '', paid_amount: '0', payment_status: '', payment_method: '', notes: '',
};

export default function Licensing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role);
  const [plans, setPlans] = useState([]);
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [filters, setFilters] = useState({ status: '', plan_id: '', q: '' });
  const [showPlanForm, setShowPlanForm] = useState(false);
  const [planForm, setPlanForm] = useState(emptyPlan);
  const [showLicForm, setShowLicForm] = useState(false);
  const [licForm, setLicForm] = useState(emptyLic);
  const [expanded, setExpanded] = useState(null);
  const [renewForm, setRenewForm] = useState({ plan_id: '', days: '', expiry_date: '', amount: '', paid_amount: '', payment_status: '', payment_method: '', notes: '' });
  const [detail, setDetail] = useState(null);

  const loadPlans = () => api.get('/licensing/plans').then(setPlans).catch((e) => setError(e.message));
  const loadStats = () => api.get('/licensing/stats').then(setStats).catch(() => {});
  const load = () => {
    loadPlans();
    loadStats();
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.plan_id) params.set('plan_id', filters.plan_id);
    if (filters.q) params.set('q', filters.q);
    api.get(`/licensing?${params.toString()}`).then(setItems).catch((e) => setError(e.message));
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  if (!isAdmin) {
    return <div className="card">Access restricted — admin only.</div>;
  }

  const detailFor = (id) => api.get(`/licensing/${id}`).then(setDetail).catch((e) => setError(e.message));

  const toggleExpand = (id) => {
    if (expanded === id) { setExpanded(null); setDetail(null); } else { setExpanded(id); detailFor(id); }
  };

  const submitPlan = async (e) => {
    e.preventDefault();
    setError(''); setSaved('');
    try {
      await api.post('/licensing/plans', planForm);
      setSaved('Plan added.');
      setPlanForm(emptyPlan);
      setShowPlanForm(false);
      loadPlans();
    } catch (err) { setError(err.message); }
  };

  const updatePlan = async (p, patch) => {
    try { await api.put(`/licensing/plans/${p.id}`, patch); loadPlans(); } catch (err) { setError(err.message); }
  };

  const deletePlan = async (p) => {
    if (!window.confirm(`Delete plan "${p.name}"?`)) return;
    try {
      const r = await api.del(`/licensing/plans/${p.id}`);
      setSaved(r.deactivated ? 'Plan deactivated (still in use).' : 'Plan deleted.');
      loadPlans();
    } catch (err) { setError(err.message); }
  };

  const submitLic = async (e) => {
    e.preventDefault();
    setError(''); setSaved('');
    try {
      await api.post('/licensing', licForm);
      setSaved('Client license created.');
      setLicForm(emptyLic);
      setShowLicForm(false);
      load();
    } catch (err) { setError(err.message); }
  };

  const updateLic = async (id, patch) => {
    try { await api.put(`/licensing/${id}`, patch); setSaved('License updated.'); load(); toggleExpand(id); } catch (err) { setError(err.message); }
  };

  const submitRenew = async (id) => {
    setError(''); setSaved('');
    try {
      const r = await api.post(`/licensing/${id}/renew`, renewForm);
      setSaved(r.status === 'ACTIVE' ? `License updated.` : `Renewal recorded. Expiry ${r.new_expiry || 'Lifetime (LIFETIME plan)'}.`);
      setRenewForm({ plan_id: '', days: '', expiry_date: '', amount: '', paid_amount: '', payment_status: '', payment_method: '', notes: '' });
      load();
      toggleExpand(id);
    } catch (err) { setError(err.message); }
  };

  const deleteLic = async (it) => {
    if (!window.confirm(`Delete license for "${it.client_name}"?`)) return;
    try { await api.del(`/licensing/${it.id}`); setSaved('Client license deleted.'); load(); } catch (err) { setError(err.message); }
  };

  const genLic = async (id, body) => {
    setError(''); setSaved('');
    try {
      const r = await api.post(`/licensing/${id}/invoice`, body);
      setSaved(`Invoice ${r.invoice_number} generated — ₹${r.grand_total.toLocaleString('en-IN')} (balance due ₹${r.balance_due.toLocaleString('en-IN')}). Record payment against it to collect.`);
      load();
      if (expanded === id) toggleExpand(id);
    } catch (err) { setError(err.message); }
  };

  const payLic = async (id, body) => {
    setError(''); setSaved('');
    try {
      const r = await api.post(`/licensing/${id}/pay`, body);
      setSaved(`Payment recorded. Balance due ₹${r.balance_due.toLocaleString('en-IN')}.`);
      load();
      if (expanded === id) toggleExpand(id);
    } catch (err) { setError(err.message); }
  };

  const setFil = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const currentMonthPaid = (stats?.monthly || []).filter((r) => r.ym === thisMonth).reduce((s, r) => s + Number(r.total), 0) || null;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="stats-grid">
        <Stat label="Total Clients" value={stats?.total ?? '—'} />
        <Stat label="Active" value={stats?.active ?? '—'} sub={`${stats?.trials ?? 0} in trial`} />
        <Stat label="Expiring ≤ 30d" value={stats?.expiring_soon ?? '—'} sub={`${stats?.renewals ?? 0} renewals booked`} />
        <Stat label="Past Due" value={stats?.past_due ?? '—'} sub={`${stats?.expired ?? 0} expired`} />
        <Stat label="Collected" value={inr(stats?.paid)} sub={`Invoiced ${inr(stats?.invoiced)}`} />
        <Stat label="Outstanding" value={inr(stats?.arrears)} />
        <Stat label="This month" value={inr(currentMonthPaid)} sub="collected from licenses" />
        <Stat label="Renewal revenue" value={inr(stats?.renewal_revenue)} />
      </div>

      {(stats?.monthly?.length || 0) > 0 && (
        <div className="grid-2">
          <div className="card">
            <div className="card-title">Revenue from licenses — last 6 months</div>
            <Bars rows={stats.monthly} total={() => Math.max(...stats.monthly.map((r) => Number(r.total)), 1)} label={(r) => r.ym} fmt={(r) => inr(r.total)} />
          </div>
          <div className="card">
            <div className="card-title">Plan mix (client count)</div>
            <PlanMix rows={(stats.by_plan || []).filter((r) => Number(r.n) > 0)} fmt={(r) => `${r.name} · ${r.n}`} />
          </div>
        </div>
      )}

      {(stats?.upcoming?.length || 0) > 0 && (
        <div className="card">
          <div className="card-title">Renewals due in the next 30 days</div>
          <table>
            <thead>
              <tr><th>Client</th><th>Plan</th><th>Expiry</th><th>Due in</th><th>Amount</th><th>Paid</th><th></th></tr>
            </thead>
            <tbody>
              {stats.upcoming.map((u) => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.client_name}</td>
                  <td>{u.plan_name || '—'}</td>
                  <td className="nowrap">{u.expiry_date}</td>
                  <td>
                    <span className={`badge ${u.days_left <= 7 ? 'badge-red' : u.days_left <= 14 ? 'badge-amber' : 'badge-blue'}`}>
                      {u.days_left} day{u.days_left === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="right nowrap">{inr(u.amount)}</td>
                  <td className="right nowrap">{inr(u.paid_amount)}</td>
                  <td className="nowrap"><button className="btn btn-sm" onClick={() => toggleExpand(u.id)}>Manage</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <span>Plan Catalog</span>
          <button className="btn btn-primary" onClick={() => { setPlanForm(emptyPlan); setShowPlanForm((v) => !v); }}>+ Add Plan</button>
        </div>
        {showPlanForm && (
          <form onSubmit={submitPlan} className="mb">
            <div className="grid-3">
              <div className="field"><label>Name *</label><input value={planForm.name} onChange={(e) => setPlanForm((f) => ({ ...f, name: e.target.value }))} required /></div>
              <div className="field"><label>Type *</label>
                <select value={planForm.type} onChange={(e) => setPlanForm((f) => ({ ...f, type: e.target.value }))}>
                  {PLAN_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field"><label>Duration (days, blank = lifetime)</label><input type="number" min="1" value={planForm.duration_days} onChange={(e) => setPlanForm((f) => ({ ...f, duration_days: e.target.value }))} /></div>
              <div className="field"><label>Price (₹)</label><input type="number" min="0" step="0.01" value={planForm.price} onChange={(e) => setPlanForm((f) => ({ ...f, price: e.target.value }))} /></div>
              <div className="field"><label>Seats</label><input type="number" min="1" value={planForm.seats} onChange={(e) => setPlanForm((f) => ({ ...f, seats: e.target.value }))} /></div>
              <div className="field"><label>Business Model Pack</label>
                <select value={planForm.business_model} onChange={(e) => setPlanForm((f) => ({ ...f, business_model: e.target.value }))}>
                  <option value="general">General Business</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="import_export">Import & Export</option>
                </select>
              </div>
            </div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              Add-on feature flags granted by this plan (over and above the model pack):
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: 10 }}>
              {PLAN_FEATURES.map((f) => (
                <label key={f.key} style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="checkbox"
                    checked={(planForm.features && planForm.features[f.key]) === true}
                    onChange={(e) => setPlanForm((pf) => {
                      const features = { ...(pf.features || {}) };
                      if (e.target.checked) features[f.key] = true; else delete features[f.key];
                      return { ...pf, features };
                    })}
                    style={{ width: 'auto' }}
                  />{' '}
                  {f.label}
                </label>
              ))}
            </div>
            <button className="btn btn-primary" type="submit">Save Plan</button>
            <button className="btn" type="button" onClick={() => setShowPlanForm(false)}>Cancel</button>
          </form>
        )}
        <table>
          <thead>
                <tr><th>Name</th><th>Type</th><th>Packs</th><th>Duration</th><th>Price</th><th>Seats</th><th>Active</th><th>Uses</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td><input defaultValue={p.name} onBlur={(e) => p.name !== e.target.value && updatePlan(p, { name: e.target.value })} style={{ maxWidth: 220 }} /></td>
                    <td><span className={`badge ${p.type === 'TRIAL' ? 'badge-blue' : p.type === 'LIFETIME' ? 'badge-gray' : 'badge-amber'}`}>{PLAN_TYPE_LABEL[p.type] || p.type}</span></td>
                    <td>
                      <span className="badge badge-gray">{MODEL_LABEL[p.business_model] || MODEL_LABEL.general}</span>{' '}
                      {(() => {
                        let feats = p.features;
                        if (typeof feats === 'string') { try { feats = JSON.parse(feats); } catch (_e) { feats = null; } }
                        const flags = feats && typeof feats === 'object' ? Object.entries(feats).filter(([, v]) => v).map(([k]) => PLAN_FEATURES.find((x) => x.key === k)?.label || k) : [];
                        return flags.length ? <span className="muted" style={{ fontSize: 11 }}>({flags.join(', ')})</span> : null;
                      })()}
                    </td>
                    <td>{p.duration_days ? `${p.duration_days} days` : 'Lifetime'}</td>
                    <td><input defaultValue={p.price} type="number" step="0.01" onBlur={(e) => String(p.price) !== String(e.target.value) && updatePlan(p, { price: e.target.value })} style={{ maxWidth: 90 }} /></td>
                    <td>{p.seats}</td>
                <td>
                  <button className={`btn btn-sm ${p.is_active ? '' : 'btn-danger'}`} onClick={() => updatePlan(p, { is_active: p.is_active ? 0 : 1 })}>{p.is_active ? 'Active' : 'Deactivated'}</button>
                </td>
                <td>{p.usage_count}</td>
                <td className="nowrap"><button className="btn btn-sm btn-danger" onClick={() => deletePlan(p)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-title">
          <span>Clients &amp; Licenses ({items.length})</span>
          <button className="btn btn-primary" onClick={() => { setLicForm({ ...emptyLic }); setShowLicForm((v) => !v); }}>+ New Client</button>
        </div>

        {showLicForm && (
          <form onSubmit={submitLic} className="mb">
            <div className="grid-3">
              <div className="field"><label>Client / Firm name *</label><input value={licForm.client_name} onChange={(e) => setLicForm((f) => ({ ...f, client_name: e.target.value }))} required /></div>
              <div className="field"><label>Contact person</label><input value={licForm.contact_person} onChange={(e) => setLicForm((f) => ({ ...f, contact_person: e.target.value }))} /></div>
              <div className="field"><label>Phone</label><input value={licForm.phone} onChange={(e) => setLicForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div className="field"><label>Email</label><input value={licForm.email} onChange={(e) => setLicForm((f) => ({ ...f, email: e.target.value }))} /></div>
              <div className="field"><label>GSTIN</label><input value={licForm.gstin} maxLength={15} onChange={(e) => setLicForm((f) => ({ ...f, gstin: e.target.value }))} /></div>
              <div className="field"><label>Plan</label>
                <select value={licForm.plan_id} onChange={(e) => {
                  const pid = e.target.value;
                  const p = plans.find((x) => String(x.id) === String(pid));
                  setLicForm((f) => ({ ...f, plan_id: pid, amount: p ? p.price : f.amount, seats: p ? p.seats : f.seats }));
                }}>
                  <option value="">— None —</option>
                  {plans.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.price}</option>)}
                </select>
              </div>
              <div className="field"><label>Start date</label><input type="date" value={licForm.start_date} onChange={(e) => setLicForm((f) => ({ ...f, start_date: e.target.value }))} /></div>
              <div className="field"><label>Expiry date (blank = from plan)</label><input type="date" value={licForm.expiry_date} onChange={(e) => setLicForm((f) => ({ ...f, expiry_date: e.target.value }))} /></div>
              <div className="field"><label>Status</label>
                <select value={licForm.status} onChange={(e) => setLicForm((f) => ({ ...f, status: e.target.value }))}>
                  {LICENSE_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="field"><label>Seats</label><input type="number" min="1" value={licForm.seats} onChange={(e) => setLicForm((f) => ({ ...f, seats: e.target.value }))} /></div>
              <div className="field"><label>Amount (₹)</label><input type="number" min="0" step="0.01" value={licForm.amount} onChange={(e) => setLicForm((f) => ({ ...f, amount: e.target.value }))} /></div>
              <div className="field"><label>Paid (₹)</label><input type="number" min="0" step="0.01" value={licForm.paid_amount} onChange={(e) => setLicForm((f) => ({ ...f, paid_amount: e.target.value }))} /></div>
              <div className="field"><label>Payment status</label>
                <select value={licForm.payment_status} onChange={(e) => setLicForm((f) => ({ ...f, payment_status: e.target.value }))}>
                  <option value="">Auto</option><option value="UNPAID">Unpaid</option><option value="PARTIAL">Partial</option><option value="PAID">Paid</option>
                </select>
              </div>
              <div className="field"><label>Payment method</label><input value={licForm.payment_method} placeholder="UPI / NEFT / Card / Cash…" onChange={(e) => setLicForm((f) => ({ ...f, payment_method: e.target.value }))} /></div>
            </div>
            <div className="field"><label>Notes</label><textarea rows={2} value={licForm.notes} onChange={(e) => setLicForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <button className="btn btn-primary" type="submit">Create License</button>
            <button className="btn" type="button" onClick={() => setShowLicForm(false)}>Cancel</button>
          </form>
        )}

        <div className="grid-3 mb">
          <div className="field"><label>Status</label>
            <select value={filters.status} onChange={setFil('status')}>
              <option value="">All</option>
              {LICENSE_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>Plan</label>
            <select value={filters.plan_id} onChange={setFil('plan_id')}>
              <option value="">All</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field"><label>Search</label><input value={filters.q} onChange={setFil('q')} placeholder="Name / contact / phone / GSTIN" /></div>
        </div>
        <div className="flex mb">
          <button className="btn" onClick={() => { setFilters({ status: '', plan_id: '', q: '' }); }}>Clear filters</button>
          <button className="btn btn-primary" onClick={() => load()}>Apply</button>
        </div>

        {items.length === 0 ? (
          <div className="empty">No client licenses yet — add your first client.</div>
        ) : (
          <table>
            <thead>
              <tr><th>Client</th><th>Plan</th><th>Status</th><th>Start</th><th>Expiry</th><th>Seats</th><th>Amount</th><th>Paid</th><th>Payment</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <LicRow key={it.id} it={it} expanded={expanded === it.id} toggle={() => toggleExpand(it.id)} detail={detail}
                  renewFormState={{ renewForm, setRenewForm }} submitRenew={submitRenew}
                  updateLic={updateLic} deleteLic={deleteLic} plans={plans} STATUS={LICENSE_STATUSES}
                  navigate={navigate} genLic={genLic} payLic={payLic} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Bars({ rows, total, label, fmt }) {
  return (
    <div className="bar-chart">
      {rows.map((r) => {
        const pct = Math.max(3, Math.round((Number(r.total) / total()) * 100));
        return (
          <div key={label(r)} className="bar-row" title={fmt(r)}>
            <div className="bar-label">{label(r)}</div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
            <div className="bar-value">{fmt(r)}</div>
          </div>
        );
      })}
    </div>
  );
}

function PlanMix({ rows, fmt }) {
  const tot = rows.reduce((s, r) => s + Number(r.n), 0) || 1;
  return (
    <div className="bar-chart">
      {rows.map((r) => (
        <div key={r.plan_id || r.name} className="bar-row" title={fmt(r)}>
          <div className="bar-label">{r.name}</div>
          <div className="bar-track" style={{ background: 'var(--bg)' }}><div className="bar-fill" style={{ width: `${Math.max(4, Math.round((Number(r.n) / tot) * 100))}%`, background: 'var(--amber)' }} /></div>
          <div className="bar-value">{fmt(r)}</div>
        </div>
      ))}
    </div>
  );
}

function LicRow({ it, expanded, toggle, detail, renewFormState, submitRenew, updateLic, deleteLic, plans, STATUS, navigate, genLic, payLic }) {
  const [edit, setEdit] = useState(null);
  const [payForm, setPayForm] = useState({ amount: '', date: new Date().toISOString().slice(0, 10), mode: 'UPI', reference_no: '', note: '' });
  const [invForm, setInvForm] = useState({ amount: it.amount || '', paid_amount: '0', gst_rate: '18', payment_mode: 'UPI', reference_no: '' });
  const { renewForm, setRenewForm } = renewFormState;
  const planOpts = plans.filter((p) => p.is_active);

  return (
    <>
      <tr>
        <td>
          <div style={{ fontWeight: 600 }}>{it.client_name}</div>
          <div className="muted" style={{ fontSize: 11 }}>{it.gstin ? `GSTIN: ${it.gstin}` : ''} {it.contact_person ? `· ${it.contact_person}` : ''} {it.phone ? `· ${it.phone}` : ''}</div>
        </td>
        <td>{it.plan_name || '—'}</td>
        <td><span className={`badge ${STATUS_BADGE[it.status] || 'badge-gray'}`}>{STATUS_LABEL[it.status] || it.status}</span></td>
        <td className="nowrap">{it.start_date}</td>
        <td className="nowrap">{it.expiry_date || 'Lifetime'}</td>
        <td>{it.seats}</td>
        <td className="right nowrap">{inr(it.amount)}</td>
        <td className="right nowrap">{inr(it.paid_amount)}</td>
        <td><span className={`badge ${PAY_BADGE[it.payment_status] || 'badge-gray'}`}>{PAY_LABEL[it.payment_status] || it.payment_status}</span></td>
        <td className="nowrap">
          <button className="btn btn-sm" onClick={toggle}>{expanded ? 'Close' : 'Manage'} </button>
          <button className="btn btn-sm btn-danger" onClick={() => deleteLic(it)}>Delete</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10}>
            <div className="card" style={{ margin: 0 }}>
              {detail?.renewals?.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>Renewal / payment history</div>
                  <table style={{ marginBottom: 12 }}>
                    <thead><tr><th>From</th><th>To</th><th>Plan</th><th>Amount</th><th>Paid</th><th>Status</th><th>Method</th><th>Notes</th></tr></thead>
                    <tbody>
                      {detail.renewals.map((r) => (
                        <tr key={r.id}>
                          <td className="nowrap">{r.from_date || '—'}</td>
                          <td className="nowrap">{r.to_date || 'Lifetime'}</td>
                          <td>{r.plan_name || '—'}</td>
                          <td className="right nowrap">{inr(r.amount)}</td>
                          <td className="right nowrap">{inr(r.paid_amount)}</td>
                          <td><span className={`badge ${PAY_BADGE[r.payment_status] || 'badge-gray'}`}>{PAY_LABEL[r.payment_status] || r.payment_status}</span></td>
                          <td>{r.payment_method || '—'}</td>
                          <td>{r.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
              <div className="grid-3">
                <div className="field"><label>Status</label>
                  <select value={edit?.status ?? it.status} onChange={(e) => setEdit((x) => ({ ...x, status: e.target.value }))}>
                    {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field"><label>Expiry date (blank = lifetime)</label>
                  <input type="date" defaultValue={it.expiry_date || ''} onChange={(e) => setEdit((x) => ({ ...x, expiry_date: e.target.value }))} />
                </div>
                <div className="field"><label>Payment status</label>
                  <select defaultValue={it.payment_status} onChange={(e) => setEdit((x) => ({ ...x, payment_status: e.target.value }))}>
                    <option value="UNPAID">Unpaid</option><option value="PARTIAL">Partial</option><option value="PAID">Paid</option>
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" onClick={() => updateLic(it.id, { status: edit?.status ?? it.status, expiry_date: edit?.expiry_date ?? it.expiry_date, payment_status: edit?.payment_status ?? it.payment_status })}>Save changes</button>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Renew / extend</div>
                <div className="grid-3">
                  <div className="field"><label>Renewal plan</label>
                    <select value={renewForm.plan_id} onChange={(e) => {
                      const pid = e.target.value;
                      const p = plans.find((x) => String(x.id) === String(pid));
                      setRenewForm((f) => ({ ...f, plan_id: pid, amount: p ? p.price : f.amount }));
                    }}>
                      <option value="">Same plan</option>
                      {planOpts.map((p) => <option key={p.id} value={p.id}>{p.name} · ₹{p.price}</option>)}
                    </select>
                  </div>
                  <div className="field"><label>OR extend days (if no plan)</label><input type="number" min="1" placeholder="e.g. 365" value={renewForm.days} onChange={(e) => setRenewForm((f) => ({ ...f, days: e.target.value }))} /></div>
                  <div className="field"><label>Or exact new expiry</label><input type="date" value={renewForm.expiry_date} onChange={(e) => setRenewForm((f) => ({ ...f, expiry_date: e.target.value }))} /></div>
                  <div className="field"><label>Amount (₹)</label><input type="number" min="0" step="0.01" value={renewForm.amount} onChange={(e) => setRenewForm((f) => ({ ...f, amount: e.target.value }))} /></div>
                  <div className="field"><label>Paid (₹)</label><input type="number" min="0" step="0.01" value={renewForm.paid_amount} onChange={(e) => setRenewForm((f) => ({ ...f, paid_amount: e.target.value }))} /></div>
                  <div className="field"><label>Method</label><input value={renewForm.payment_method} placeholder="UPI / NEFT / Card…" onChange={(e) => setRenewForm((f) => ({ ...f, payment_method: e.target.value }))} /></div>
                </div>
                <button className="btn btn-primary" onClick={() => submitRenew(it.id)}>Record renewal</button>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Billing &amp; collection</div>
                {it.invoice_id ? (
                  <>
                    <div className="mb">
                      <span className={`badge ${it.invoice_status === 'PAID' ? 'badge-green' : it.invoice_status === 'PARTIAL' ? 'badge-amber' : 'badge-blue'}`}>{it.invoice_status}</span>{' '}
                      Invoice <a href="#" onClick={(e) => { e.preventDefault(); navigate(`/invoices/${it.invoice_id}`); }}>{it.invoice_number}</a>
                      {' '}— ₹{((it.invoice_grand || 0)).toLocaleString('en-IN')} (paid ₹{(((it.invoice_grand || 0) - (it.invoice_balance ?? 0))).toLocaleString('en-IN')}, balance ₹{(it.invoice_balance ?? 0).toLocaleString('en-IN')})
                    </div>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>Record payment received</div>
                    <div className="grid-3">
                      <div className="field"><label>Amount (₹) *</label><input type="number" min="0" step="0.01" value={payForm.amount} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))} /></div>
                      <div className="field"><label>Date</label><input type="date" value={payForm.date} onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))} /></div>
                      <div className="field"><label>Mode</label><input value={payForm.mode} onChange={(e) => setPayForm((f) => ({ ...f, mode: e.target.value }))} /></div>
                      <div className="field"><label>Reference (UTR/UPI id)</label><input value={payForm.reference_no} onChange={(e) => setPayForm((f) => ({ ...f, reference_no: e.target.value }))} /></div>
                      <div className="field"><label>Note</label><input value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} /></div>
                      <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={() => payLic(it.id, payForm)}>Record payment</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="muted mb" style={{ margin: 0 }}>No invoice yet. Generate a GST sales invoice for this license; payment can be recorded against it right after.</div>
                    <div className="grid-3">
                      <div className="field"><label>Amount (₹, default = license amount)</label><input type="number" min="0" step="0.01" value={invForm.amount} onChange={(e) => setInvForm((f) => ({ ...f, amount: e.target.value }))} /></div>
                      <div className="field"><label>Advance paid now (₹)</label><input type="number" min="0" step="0.01" value={invForm.paid_amount} onChange={(e) => setInvForm((f) => ({ ...f, paid_amount: e.target.value }))} /></div>
                      <div className="field"><label>GST % (services)</label><input type="number" min="0" max="28" step="0.01" value={invForm.gst_rate} onChange={(e) => setInvForm((f) => ({ ...f, gst_rate: e.target.value }))} /></div>
                      <div className="field"><label>Payment mode (advance)</label><input value={invForm.payment_mode} onChange={(e) => setInvForm((f) => ({ ...f, payment_mode: e.target.value }))} /></div>
                      <div className="field"><label>Reference</label><input value={invForm.reference_no} onChange={(e) => setInvForm((f) => ({ ...f, reference_no: e.target.value }))} /></div>
                      <div className="field" style={{ display: 'flex', alignItems: 'flex-end' }}>
                        <button className="btn btn-primary" onClick={() => genLic(it.id, invForm)}>Generate invoice</button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}