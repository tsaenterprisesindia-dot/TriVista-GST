import { useEffect, useState } from 'react';
import { api } from '../api/client';

const fields = [
  'company_name',
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
  'gst_tax_preference',
  'round_off',
];

export default function CompanySettings() {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [loading, setLoading] = useState(true);

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

  if (loading) return <div>Loading…</div>;

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <form onSubmit={submit}>
        <div className="card">
          <div className="card-title">Business</div>
          <div className="grid-3">
            <div className="field">
              <label>Company Name</label>
              <input value={form.company_name} onChange={set('company_name')} />
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

        <button className="btn btn-primary" type="submit">Save Settings</button>
      </form>
    </>
  );
}