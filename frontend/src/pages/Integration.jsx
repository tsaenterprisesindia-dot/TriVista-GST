import { useEffect, useState } from 'react';
import { api } from '../api/client';

const invoiceNumber = (inv) => inv.invoice_number || inv.number || inv.id;

export default function Integration() {
  const [invoices, setInvoices] = useState([]);
  const [invoiceId, setInvoiceId] = useState('');
  const [logs, setLogs] = useState([]);
  const [payload, setPayload] = useState(null);
  const [simIr, setSimIr] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const [eway, setEway] = useState({ transporter_name: '', vehicle_no: '', transporter_gstin: '', gcn_no: '', distance_km: '' });
  const [ewayPayload, setEwayPayload] = useState(null);

  const loadLogs = () => {
    api.get('/integration/einvoice').then((d) => setLogs(d || [])).catch(() => {});
  };

  useEffect(() => {
    api.get('/invoices?limit=50').then((d) => setInvoices(d.data || d || [])).catch(() => {});
    loadLogs();
  }, []);

  const setE = (k) => (e) => setEway((w) => ({ ...w, [k]: e.target.value }));

  const generate = async () => {
    setError('');
    setSaved('');
    try {
      const d = await api.post(`/integration/einvoice/${invoiceId}/generate`);
      setPayload(d);
      setSaved('e-Invoice JSON generated.');
      loadLogs();
    } catch (e) {
      setError(e.message);
    }
  };

  const simulateIrn = async () => {
    setError('');
    try {
      const d = await api.post(`/integration/einvoice/${invoiceId}/simulate-irn`);
      setSimIr(d);
      setSaved('IRN simulated.');
      loadLogs();
    } catch (e) {
      setError(e.message);
    }
  };

  const submitIrn = async () => {
    setError('');
    try {
      const d = await api.post(`/integration/einvoice/${invoiceId}/submit`);
      setSimIr(d);
      setSaved(d.message);
      loadLogs();
    } catch (e) {
      setError(e.message);
    }
  };

  const generateEway = async () => {
    setError('');
    try {
      const d = await api.post(`/integration/ewaybill/${invoiceId}/generate`, eway);
      setEwayPayload(d);
      setSaved('e-Way Bill generated.');
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      {error && <div className="error-banner">{error}</div>}
      {saved && <div className="success-banner">{saved}</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-title">e-Invoice</div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            Registered supplier: Irn √, RegRev N. Services are flagged IsServc Y (SAC) / N (HSN).
            Generations and submissions are audit-logged below.
          </div>
          <div className="field">
            <label>Invoice</label>
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
              <option value="">— Select —</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>{invoiceNumber(inv)}</option>
              ))}
            </select>
          </div>
          <div className="flex">
            <button className="btn btn-primary" disabled={!invoiceId} onClick={generate}>Generate e-Invoice JSON</button>
            <button className="btn" disabled={!invoiceId} onClick={simulateIrn}>Simulate IRN</button>
            <button className="btn btn-danger" disabled={!invoiceId} onClick={submitIrn}>Submit to IRP</button>
          </div>
          {payload && (
            <div className="field mt">
              <label>Generated Payload</label>
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          )}
          {simIr && (
            <div className="field mt">
              <label>IRN Result</label>
              {simIr.qr_url && (
                <div style={{ marginBottom: 10, textAlign: 'center' }}>
                  <img src={simIr.qr_url} alt="IRN QR" style={{ width: 170, height: 170, border: '1px solid #ddd', borderRadius: 8 }} />
                  {simIr.irn && <div className="muted" style={{ marginTop: 6, fontSize: 12, wordBreak: 'break-all' }}>{simIr.irn}</div>}
                </div>
              )}
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(simIr, null, 2)}
              </pre>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-title">e-Way Bill</div>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
            An e-Way Bill is required when the consignment value exceeds ₹50,000 (exports and QRMP
            transporters are exempt). Below the threshold the generator simply returns required:false.
          </div>
          <div className="field">
            <label>Invoice</label>
            <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
              <option value="">— Select —</option>
              {invoices.map((inv) => (
                <option key={inv.id} value={inv.id}>{invoiceNumber(inv)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Transporter Name</label>
            <input value={eway.transporter_name} onChange={setE('transporter_name')} />
          </div>
          <div className="field">
            <label>Vehicle No</label>
            <input value={eway.vehicle_no} onChange={setE('vehicle_no')} />
          </div>
          <div className="field">
            <label>Transporter GSTIN</label>
            <input value={eway.transporter_gstin} onChange={setE('transporter_gstin')} />
          </div>
          <div className="field">
            <label>GCN / LR No</label>
            <input value={eway.gcn_no} onChange={setE('gcn_no')} />
          </div>
          <div className="field">
            <label>Distance (km)</label>
            <input value={eway.distance_km} onChange={setE('distance_km')} type="number" placeholder="Required on 2nd leg of movement (Part-B)" />
          </div>
          <button className="btn btn-primary" disabled={!invoiceId} onClick={generateEway}>Generate e-Way Bill</button>
          {ewayPayload && (
            <div className="field mt">
              <label>e-Way Bill Payload {ewayPayload.required === false && <span className="badge badge-amber">Not required — {ewayPayload.reason || 'below threshold'}</span>}</label>
              <pre style={{ background: '#f8fafc', padding: 12, borderRadius: 8, overflow: 'auto', fontSize: 12 }}>
                {JSON.stringify(ewayPayload, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-title">e-Invoice Logs</div>
        {logs.length === 0 ? (
          <div className="empty">No e-invoice activity yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Status</th>
                <th>IRN</th>
                <th>Ack</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{l.invoice_number}</td>
                  <td>
                    {l.status === 'GENERATED' ? (
                      <span className="badge badge-green">{l.status}</span>
                    ) : (
                      <span className="badge badge-amber">{l.status}</span>
                    )}
                  </td>
                  <td className="nowrap">{l.irn || '—'}</td>
                  <td className="nowrap">{l.ack_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}