import { useEffect, useState } from 'react';
import { api } from '../api/client';

const fields = [
  'company_name',
  'legal_name',
  'trade_name',
  'constitution',
  'gstin',
  'pan',
  'tan',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'state_code',
  'pincode',
  'phone',
  'email',
  'website',
  'invoice_prefix',
  'invoice_start_number',
  'invoice_footer_note',
  'bank_name',
  'bank_account_no',
  'bank_ifsc',
  'upi_id',
  'upi_beneficiary',
  'gst_tax_preference',
  'round_off',
  'business_type',
  'e_invoice_enabled',
  'aggregate_turnover_crores',
  'apply_tds',
  'apply_tcs',
  'tds_rate',
  'tcs_rate',
  'tds_threshold',
  'tcs_threshold',
];

export default function CompanySettings() {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);
  const [backups, setBackups] = useState([]);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState({
    IRP_ENDPOINT: '',
    IRP_AUTH: '',
    IRP_CANCEL_ENDPOINT: '',
    EWB_ENDPOINT: '',
    EWB_AUTH: '',
  });
  const [intStatus, setIntStatus] = useState(null);
  const [credsMsg, setCredsMsg] = useState('');
  const [branches, setBranches] = useState([]);
  const [activeBranchId, setActiveBranchId] = useState(null);
  const [brForm, setBrForm] = useState({});
  const [editingBr, setEditingBr] = useState(null);
  const [brMsg, setBrMsg] = useState('');

  useEffect(() => {
    api
      .get('/company')
      .then((d) => {
        const f = {};
        fields.forEach((k) => (f[k] = d[k] ?? ''));
        setForm(f);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    api
      .get('/company/backups')
      .then((list) => setBackups(list || []))
      .catch(() => {});
    api
      .get('/integration/settings')
      .then((d) => setCreds((c) => ({ ...c, ...d, env_file: undefined })))
      .catch(() => {});
    api
      .get('/integration/status')
      .then(setIntStatus)
      .catch(() => {});
    api
      .get('/branches')
      .then((d) => {
        setBranches(d.data || []);
        setActiveBranchId(d.activeBranchId || null);
      })
      .catch(() => {});
  }, []);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    try {
      await api.put('/company', form);
      setSaved('Settings saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const setCred = (k) => (e) => setCreds((c) => ({ ...c, [k]: e.target.value }));

  const saveCreds = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    setCredsMsg('Saving…');
    try {
      const r = await api.put('/integration/settings', creds);
      setCredsMsg(r.message);
      api.get('/integration/status').then(setIntStatus).catch(() => {});
    } catch (err) {
      setError(err.message);
      setCredsMsg('');
    }
  };

  if (loading) return <div>Loading…</div>;

  const reloadBranches = () =>
    api.get('/branches').then((d) => {
      setBranches(d.data || []);
      setActiveBranchId(d.activeBranchId || null);
    });

  const refreshCompany = () =>
    api.get('/company').then((d) => {
      const f = {};
      fields.forEach((k) => (f[k] = d[k] ?? ''));
      setForm(f);
    });

  const setBr = (k) => (e) =>
    setBrForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const saveBranch = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    setBrMsg('');
    try {
      const payload = {
        branch_name: (brForm.branch_name || '').trim(),
        company_name: brForm.company_name || form.legal_name || form.company_name || '',
        gstin: (brForm.gstin || '').trim() || null,
        pan: (brForm.pan || '').trim() || null,
        address_line1: brForm.address_line1 || null,
        city: brForm.city || null,
        state: brForm.state || null,
        state_code: brForm.state_code || null,
        pincode: brForm.pincode || null,
        phone: brForm.phone || null,
        email: brForm.email || null,
        invoice_prefix: (brForm.invoice_prefix || 'INV').trim() || 'INV',
        invoice_start_number: Number(brForm.invoice_start_number || 0),
      };
      if (editingBr) {
        await api.put(`/branches/${editingBr.id}`, payload);
        setBrMsg('Unit updated.');
      } else {
        await api.post('/branches', payload);
        setBrMsg('Unit added.');
      }
      setBrForm({});
      setEditingBr(null);
      await reloadBranches();
      if (editingBr && activeBranchId === editingBr.id) await refreshCompany();
    } catch (err) {
      setError(err.message);
    }
  };

  const activateBranch = async (id) => {
    setError('');
    setSaved('');
    try {
      const r = await api.post(`/branches/${id}/activate`, {});
      setSaved(r.message);
      await reloadBranches();
      await refreshCompany();
    } catch (err) {
      setError(err.message);
    }
  };

  const deactivateBranch = async (id) => {
    setError('');
    setSaved('');
    try {
      const r = await api.delete(`/branches/${id}`);
      setBrMsg(r.message);
      await reloadBranches();
    } catch (err) {
      setError(err.message);
    }
  };

  const startEdit = (br) => {
    setError('');
    const { id, created_at, updated_at, ...rest } = br;
    setEditingBr(br);
    setBrForm({ ...rest, invoice_start_number: rest.invoice_start_number || 0 });
  };
  const cancelEdit = () => {
    setEditingBr(null);
    setBrForm({});
  };

  const clearData = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    const pw = e.target.password.value;
    if (!confirm('This will permanently delete ALL invoices, bills, products, stock, customers, vendors, payments, logs, transactions and API keys (including demo data).\n\nYour login, company profile, chart of accounts and HSN masters will be kept. This cannot be undone.')) return;
    try {
      await api.post('/company/clear-data', { password: pw });
      setSaved('All business & demo data cleared. Refreshing…');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err.message);
    }
  };

  const doBackup = async () => {
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const r = await api.get('/company/backup');
      setSaved(`Backup created: ${r.file}`);
      setBackups(await api.get('/company/backups'));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (e) => {
    e.preventDefault();
    setError('');
    setSaved('');
    const pw = e.target.password.value;
    const file = e.target.file.value;
    if (!file) return setError('Choose a backup file to restore.');
    if (!confirm(`Restore database from "${file}"? This overwrites all current data with the backup contents, and cannot be undone.\n\nTake a fresh backup first if unsure.`)) return;
    setBusy(true);
    try {
      const r = await api.post('/company/restore', { file, password: pw });
      setSaved(`${r.message} Reloading…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <form onSubmit={submit}>
        <div className="card">
          <div className="card-title">Business / Enterprise Master</div>
          <div className="grid-3">
            <div className="field">
              <label>Legal Name</label>
              <input value={form.legal_name} onChange={set('legal_name')} placeholder="Registered company / proprietorship name" />
            </div>
            <div className="field">
              <label>Trade Name</label>
              <input value={form.trade_name} onChange={set('trade_name')} placeholder="Brand name on invoices (optional)" />
            </div>
            <div className="field">
              <label>Constitution of Business</label>
              <select value={form.constitution} onChange={set('constitution')}>
                <option value="">— Select —</option>
                <option>Sole Proprietorship</option>
                <option>Partnership</option>
                <option>LLP</option>
                <option>Private Limited</option>
                <option>Public Limited</option>
                <option>One Person Company</option>
                <option>HUF</option>
                <option>Trust / Society</option>
                <option>Other</option>
              </select>
            </div>
            <div className="field">
              <label>Company Name</label>
              <input value={form.company_name} onChange={set('company_name')} />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Used on printed invoices. Clear Trade Name to print this instead of the brand name.
              </div>
            </div>
            <div className="field">
              <label>GSTIN</label>
              <input value={form.gstin} onChange={set('gstin')} />
            </div>
            <div className="field">
              <label>PAN</label>
              <input value={form.pan} onChange={set('pan')} />
            </div>
            <div className="field">
              <label>TAN</label>
              <input value={form.tan} onChange={set('tan')} />
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
              <label>Website</label>
              <input value={form.website} onChange={set('website')} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Address</div>
          <div className="grid-3">
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
              <label>State Code</label>
              <input value={form.state_code} onChange={set('state_code')} maxLength={2} />
            </div>
            <div className="field">
              <label>Pincode</label>
              <input value={form.pincode} onChange={set('pincode')} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Invoicing</div>
          <div className="grid-3">
            <div className="field">
              <label>Invoice Prefix</label>
              <input value={form.invoice_prefix} onChange={set('invoice_prefix')} />
            </div>
            <div className="field">
              <label>Invoice Start Number</label>
              <input value={form.invoice_start_number} onChange={set('invoice_start_number')} type="number" />
            </div>
            <div className="field">
              <label>GST Tax Preference</label>
              <select value={form.gst_tax_preference} onChange={set('gst_tax_preference')}>
                <option value="EXCLUSIVE">EXCLUSIVE</option>
                <option value="INCLUSIVE">INCLUSIVE</option>
              </select>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={!!form.round_off} onChange={set('round_off')} style={{ width: 'auto' }} />{' '}
                Round Off
              </label>
            </div>
            <div className="field">
              <label>Business Type</label>
              <select value={form.business_type} onChange={set('business_type')}>
                <option value="retail">Products (Retail Sale)</option>
                <option value="wholesale">Products (Wholesale)</option>
                <option value="services">Services</option>
                <option value="mixed">Products &amp; Services (Retail + Wholesale)</option>
              </select>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                Adapts the menu &amp; flow: Services hides Inventory/Products; Products shows stock.
              </div>
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>Invoice Footer Note</label>
              <textarea value={form.invoice_footer_note} onChange={set('invoice_footer_note')} rows={2} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Bank</div>
          <div className="grid-3">
            <div className="field">
              <label>Bank Name</label>
              <input value={form.bank_name} onChange={set('bank_name')} />
            </div>
            <div className="field">
              <label>Account No</label>
              <input value={form.bank_account_no} onChange={set('bank_account_no')} />
            </div>
            <div className="field">
              <label>IFSC</label>
              <input value={form.bank_ifsc} onChange={set('bank_ifsc')} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">UPI Payments</div>
          <div className="grid-3">
            <div className="field">
              <label>UPI ID</label>
              <input value={form.upi_id} onChange={set('upi_id')} placeholder="e.g. yourname@okhdfcbank" />
            </div>
            <div className="field">
              <label>UPI Beneficiary Name (shown on QR / pay page)</label>
              <input value={form.upi_beneficiary} onChange={set('upi_beneficiary')} placeholder="Name buyers see when paying" />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <div className="muted" style={{ fontSize: 12 }}>
                Use this page to pay. In the <strong>Collect Payments</strong> menu you can create a shareable UPI
                payment link (with QR + tap-to-pay) for any invoice or amount. Remember to save settings first.
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Compliance (TDS / TCS / e-Invoice)</div>
          <div className="grid-3">
            <div className="field">
              <label>
                <input type="checkbox" checked={!!form.e_invoice_enabled} onChange={set('e_invoice_enabled')} style={{ width: 'auto' }} />{' '}
                e-Invoicing Enabled (IRN required)
              </label>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                10+ days old un-IRN invoices generate a compliance alert.
              </div>
            </div>
            <div className="field">
              <label>Aggregate Turnover (₹ Crores)</label>
              <input value={form.aggregate_turnover_crores} onChange={set('aggregate_turnover_crores')} type="number" step="0.01" />
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                ≥ ₹5 cr → e-invoicing / e-way bill mandate.
              </div>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={!!form.apply_tds} onChange={set('apply_tds')} style={{ width: 'auto' }} />{' '}
                Deduct TDS (Sec 194Q – 0.1% purchases)
              </label>
            </div>
            <div className="field">
              <label>
                <input type="checkbox" checked={!!form.apply_tcs} onChange={set('apply_tcs')} style={{ width: 'auto' }} />{' '}
                Collect TCS (Sec 206C(1H) – 0.1% sales)
              </label>
            </div>
            <div className="field">
              <label>TDS Rate (%)</label>
              <input value={form.tds_rate} onChange={set('tds_rate')} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>TCS Rate (%)</label>
              <input value={form.tcs_rate} onChange={set('tcs_rate')} type="number" step="0.01" />
            </div>
            <div className="field">
              <label>TDS Threshold (₹)</label>
              <input value={form.tds_threshold} onChange={set('tds_threshold')} type="number" />
            </div>
            <div className="field">
              <label>TCS Threshold (₹)</label>
              <input value={form.tcs_threshold} onChange={set('tcs_threshold')} type="number" />
            </div>
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <div className="muted" style={{ fontSize: 12 }}>
                TDS/TCS apply on the portion of a single transaction above the threshold (per customer/vendor per FY). When no PAN is on file, TCS is charged at 1.0% (Sec 206CC) and TDS at 5.0% (Sec 206AA). Values are reported in GSTR 27EQ / 26Q export.
              </div>
            </div>
          </div>
        </div>

        <button className="btn btn-primary" type="submit">Save Settings</button>
      </form>

      {(() => {
        const isNew = editingBr === null;
        return (
          <div className="card" style={{ marginTop: '16px' }}>
            <div className="card-title">Units / Branches</div>
            <p style={{ marginBottom: '10px', fontSize: '13px' }}>
              Each unit/branch can have its own registered GSTIN, address, state and per-branch billing series.
              The <strong>active unit</strong> appears on invoices and e-invoice. Switch units freely - printed name,
              GSTIN, address and invoice numbering follow the active unit.
            </p>
            {brMsg && <div className="success-banner">{brMsg}</div>}
            <div className="table-wrap" style={{ marginBottom: '14px' }}>
              <table>
                <thead>
                  <tr>
                    <th>Unit / Branch</th>
                    <th>Type</th>
                    <th>GSTIN</th>
                    <th>State</th>
                    <th>Invoice Prefix</th>
                    <th>Start No.</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((br) => (
                    <tr key={br.id}>
                      <td>
                        {br.branch_name}
                        {br.city ? <div className="muted" style={{ fontSize: 11 }}>{br.address_line1 ? `${br.address_line1}, ` : ''}{br.city}{br.pincode ? ` - ${br.pincode}` : ''}</div> : ''}
                      </td>
                      <td>{br.is_head_office ? 'Head Office' : 'Branch'}</td>
                      <td className="nowrap">{br.gstin || '—'}</td>
                      <td>{br.state_code || '—'}</td>
                      <td>{br.invoice_prefix || 'INV'}</td>
                      <td>{br.invoice_start_number || 0}</td>
                      <td>
                        {activeBranchId === br.id ? <span className="badge badge-green">ACTIVE</span> : br.is_active ? <span className="badge badge-gray">Ready</span> : <span className="badge badge-amber">Inactive</span>}
                      </td>
                      <td className="nowrap" style={{ textAlign: 'right' }}>
                        {activeBranchId !== br.id && br.is_active && (
                          <button className="btn btn-sm" type="button" onClick={() => activateBranch(br.id)}>Set Active</button>
                        )}{' '}
                        <button className="btn btn-sm" type="button" onClick={() => (editingBr && editingBr.id === br.id ? cancelEdit() : startEdit(br))}>
                          {editingBr && editingBr.id === br.id ? 'Cancel Edit' : 'Edit'}
                        </button>{' '}
                        {br.is_active && !br.is_head_office && activeBranchId !== br.id && (
                          <button className="btn btn-sm btn-danger" type="button" onClick={() => deactivateBranch(br.id)}>Deactivate</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {branches.length === 0 && (
                    <tr><td colSpan={8} className="muted">No units yet - add your first unit below.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <form onSubmit={saveBranch}>
              <div className="grid-3">
                <div className="field">
                  <label>{isNew ? 'Unit / Branch Name *' : 'Unit / Branch Name'}</label>
                  <input value={brForm.branch_name || ''} onChange={setBr('branch_name')} required={isNew} />
                </div>
                <div className="field">
                  <label>GSTIN (leave blank if not separately registered)</label>
                  <input value={brForm.gstin || ''} onChange={setBr('gstin')} maxLength={15} />
                </div>
                <div className="field">
                  <label>State / UT</label>
                  <input value={brForm.state || ''} onChange={setBr('state')} />
                </div>
                <div className="field">
                  <label>State Code</label>
                  <input value={brForm.state_code || ''} onChange={setBr('state_code')} maxLength={2} />
                </div>
                <div className="field">
                  <label>City / Place of Business</label>
                  <input value={brForm.city || ''} onChange={setBr('city')} />
                </div>
                <div className="field">
                  <label>Pincode</label>
                  <input value={brForm.pincode || ''} onChange={setBr('pincode')} />
                </div>
                <div className="field">
                  <label>Address</label>
                  <input value={brForm.address_line1 || ''} onChange={setBr('address_line1')} />
                </div>
                <div className="field">
                  <label>Phone</label>
                  <input value={brForm.phone || ''} onChange={setBr('phone')} />
                </div>
                <div className="field">
                  <label>Email</label>
                  <input value={brForm.email || ''} onChange={setBr('email')} type="email" />
                </div>
                <div className="field">
                  <label>Invoice Prefix</label>
                  <input value={brForm.invoice_prefix || ''} onChange={setBr('invoice_prefix')} placeholder="e.g. BR1" />
                </div>
                <div className="field">
                  <label>Invoice Start Number</label>
                  <input value={brForm.invoice_start_number || 0} onChange={setBr('invoice_start_number')} type="number" />
                </div>
              </div>
              <div className="flex" style={{ gap: 12, marginTop: 4 }}>
                <button className="btn btn-primary" type="submit">{isNew ? 'Add Unit' : 'Save Unit'} </button>
                {!isNew && (
                  <button className="btn" type="button" onClick={cancelEdit}>Cancel</button>
                )}
              </div>
            </form>
          </div>
        );
      })()}

      <form onSubmit={saveCreds} style={{ marginTop: '16px' }}>
        <div className="card">
          <div className="card-title">Live IRP / e-Way Credentials</div>
          <div className="flex" style={{ gap: 14, marginBottom: 10 }}>
            <span className={`badge ${intStatus?.irp?.enabled ? 'badge-green' : 'badge-gray'}`}>
              e-Invoice · {intStatus?.irp?.enabled ? 'LIVE' : 'OFFLINE'}
            </span>
            <span className={`badge ${intStatus?.ewb?.enabled ? 'badge-green' : 'badge-gray'}`}>
              e-Way Bill · {intStatus?.ewb?.enabled ? 'LIVE' : 'OFFLINE'}
            </span>
            {(intStatus?.irp?.auth_set || intStatus?.ewb?.auth_set) && (
              <span className="badge badge-amber">creds saved — auth {intStatus.irp.auth_set ? 'IRP' : ''}{intStatus.irp.auth_set && intStatus.ewb.auth_set ? ' & ' : ''}{intStatus.ewb.auth_set ? 'EWB' : ''}</span>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
            Enter the GSP credentials supplied for live operation. Saved to <code>backend/.env</code>, effective
            immediately — no restart needed. When blank, e-Invoice &amp; e-Way run in offline/sandbox mode and cannot
            submit to the GST portal.
          </div>
          <div className="grid-2">
            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <label>IRP Endpoint (e-Invoice generation URL)</label>
              <input value={creds.IRP_ENDPOINT} onChange={setCred('IRP_ENDPOINT')} placeholder="https://api.gsp.in/irp/api/v1.03/..." />
            </div>
            <div className="field">
              <label>IRP Auth (token)</label>
              <input value={creds.IRP_AUTH} onChange={setCred('IRP_AUTH')} type="password" placeholder="Bearer token / app key" />
            </div>
            <div className="field">
              <label>IRP Cancel Endpoint (IRN cancellation, optional)</label>
              <input value={creds.IRP_CANCEL_ENDPOINT} onChange={setCred('IRP_CANCEL_ENDPOINT')} placeholder="https://api.gsp.in/irp/api/v1.03/..." />
            </div>
            <div className="field">
              <label>e-Way Bill Endpoint (EWB generation URL)</label>
              <input value={creds.EWB_ENDPOINT} onChange={setCred('EWB_ENDPOINT')} placeholder="https://api.gsp.in/ewb/api/..." />
            </div>
            <div className="field">
              <label>e-Way Bill Auth (token)</label>
              <input value={creds.EWB_AUTH} onChange={setCred('EWB_AUTH')} type="password" placeholder="Bearer token / app key" />
            </div>
          </div>
          {credsMsg && <div className="success-banner">{credsMsg}</div>}
          <button className="btn btn-primary" type="submit">Save Credentials</button>
        </div>
      </form>

      <div className="card" style={{ marginTop: '16px' }}>
        <div className="card-title">Backup &amp; Restore</div>
        <p style={{ marginBottom: '10px', fontSize: '13px' }}>
          Keep a full database snapshot before major changes. Restore overwrites all current data — a password is
          required and a fresh backup is recommended first.
        </p>
        <div className="flex" style={{ gap: 12, marginBottom: '12px' }}>
          <button className="btn" type="button" onClick={doBackup} disabled={busy}>
            {busy ? 'Working…' : 'Create Backup'}
          </button>
        </div>
        {backups.length > 0 && (
          <div className="table-wrap" style={{ marginBottom: '14px' }}>
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size (KB)</th>
                  <th>Taken</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.file}>
                    <td>{b.file}</td>
                    <td>{(b.size / 1024).toFixed(1)}</td>
                    <td>{new Date(b.mtime).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form onSubmit={doRestore} className="grid-3" style={{ alignItems: 'end' }}>
          <div className="field">
            <label>Backup file to restore</label>
            <select name="file" required>
              {backups.map((b) => (
                <option key={b.file} value={b.file}>{b.file}</option>
              ))}
              {backups.length === 0 && <option value="">No backups yet</option>}
            </select>
          </div>
          <div className="field">
            <label>Type your password to confirm</label>
            <input name="password" type="password" autoComplete="off" required />
          </div>
          <button className="btn btn-danger" type="submit" disabled={busy}>
            Restore Database
          </button>
        </form>
      </div>

      <div className="card" style={{ border: '1px solid var(--red)', marginTop: '16px' }}>
        <div className="card-title" style={{ color: 'var(--red)' }}>Danger Zone</div>
        <p style={{ marginBottom: '10px', fontSize: '13px' }}>
          Clear all data permanently — including the demo invoices, products, customers, stock,
          payments, transactions, logs and API keys. Your login, company profile, chart of accounts
          and HSN master codes are <strong>kept</strong>. Deletes cannot be undone — back up first if unsure.
        </p>
        <form onSubmit={clearData} className="grid-3" style={{ alignItems: 'end' }}>
          <div className="field">
            <label>Type your password to confirm</label>
            <input name="password" type="password" autoComplete="off" required />
          </div>
          <button className="btn btn-danger" type="submit">Clear All Data</button>
        </form>
      </div>
    </>
  );
}