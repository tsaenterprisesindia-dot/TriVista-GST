const { getPool } = require('../db');
const { audit } = require('../utils/audit');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const CRED_KEYS = ['IRP_ENDPOINT', 'IRP_AUTH', 'IRP_CANCEL_ENDPOINT', 'EWB_ENDPOINT', 'EWB_AUTH'];

async function getSettings(req, res, next) {
  try {
    const settings = {};
    for (const k of CRED_KEYS) {
      settings[k] = process.env[k] ? (k.endsWith('_AUTH') ? '********' : process.env[k]) : '';
    }
    settings.env_file = path.join(process.cwd(), '.env');
    res.json(settings);
  } catch (e) {
    next(e);
  }
}

async function saveSettings(req, res, next) {
  try {
    const envPath = path.join(process.cwd(), '.env');
    let text = '';
    if (fs.existsSync(envPath)) {
      text = fs.readFileSync(envPath, 'utf8');
    } else if (!fs.existsSync(path.dirname(envPath))) {
      throw Object.assign(new Error(`.env folder not found: ${path.dirname(envPath)}`), { status: 500 });
    }
    const parsed = { ...(dotenv.parse(text) || {}) };
    for (const k of CRED_KEYS) {
      const v = req.body?.[k];
      if (typeof v !== 'string') continue;
      const value = v.trim();
      if (value && (k.endsWith('_AUTH') && value === '********')) continue; // unchanged masked value
      parsed[k] = value;
    }
    let out = '';
    for (const [k, v] of Object.entries(parsed)) {
      out += `${k}=${v}\n`;
    }
    fs.writeFileSync(envPath, out, 'utf8');
    for (const k of CRED_KEYS) process.env[k] = parsed[k] || '';
    await audit(req, 'UPDATE', 'integration_settings', null, { keys: Object.keys(req.body || {}) });
    res.json({ message: 'Integration credentials saved. Restart not required.', env_file: envPath });
  } catch (e) {
    next(e);
  }
}

/**
 * Build e-Invoice payload conforming to GSTN 1.03 schema.
 * Uses company_settings as the seller and invoice rows as items.
 */
async function buildEinvoicePayload(invoiceId) {
  const pool = getPool();
  const [invRows] = await pool.query('SELECT * FROM invoices WHERE id=?', [invoiceId]);
  if (!invRows.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  const inv = invRows[0];
  const [items] = await pool.query(
    `SELECT ii.*, p.unit FROM invoice_items ii LEFT JOIN products p ON p.id=ii.product_id WHERE ii.invoice_id=? ORDER BY ii.id`,
    [invoiceId]
  );
  const [cus] = await pool.query('SELECT * FROM customers WHERE id=?', [inv.customer_id]);
  const customer = cus[0] || {};
  const [co] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
  const company = co[0] || {};

  const [districtRows] = await pool.query("SELECT city, state FROM customers WHERE id=? LIMIT 1", [inv.customer_id]);

  const sellerState = company.state || customer.state || '';
  const sellerPincode = company.pincode || '';
  const buyerState = customer.state || '';
  const buyerPincode = customer.pincode || '';

  const itemList = items.map((it, i) => ({
    SlNo: i + 1,
    IsServc: it.gst_rate ? 'N' : 'N',
    ItmDet: {
      Barcde: null,
      GstRt: Number(it.gst_rate) || 0,
      HsnCd: it.hsn_code || '',
      TotAmt: Number(it.total) || 0,
      TotVal: Number(it.taxable_value) || 0,
    },
    PrdDesc: it.item_name || '',
    Qty: Number(it.quantity) || 1,
    Unit: it.unit || 'PCS',
    UntPrice: Number(it.unit_price) || 0,
  }));

  return {
    Version: '1.03',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: inv.invoice_type === 'B2B' ? 'B2B' : 'B2C',
      RegRev: inv.is_interstate ? 'Y' : 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: 'INV',
      No: inv.invoice_number,
      Dt: inv.invoice_date,
    },
    SellerDtls: {
      Gstin: company.gstin || '',
      LglNm: company.company_name || '',
      TrdNm: company.company_name || '',
      Addr1: company.address_line1 || '',
      Addr2: company.address_line2 || '',
      Loc: company.city || sellerState,
      Pin: sellerPincode,
      Stcd: company.state_code || '',
      Ph: company.phone || '',
      Em: company.email || '',
    },
    BuyerDtls: {
      Gstin: customer.gstin || 'URP',
      LglNm: customer.company_name || customer.name || '',
      TrdNm: customer.company_name || '',
      Pos: inv.place_of_supply || customer.state_code || '',
      Addr1: customer.address_line1 || '',
      Addr2: customer.address_line2 || '',
      Loc: customer.city || buyerState,
      Pin: buyerPincode,
      Stcd: customer.state_code || '',
    },
    ShipDtls: {
      Gstin: null,
      LglNm: customer.company_name || customer.name || '',
      Addr1: customer.address_line1 || '',
      Loc: customer.city || '',
      Pin: customer.pincode || '',
      Stcd: customer.state_code || '',
    },
    ItemList: itemList,
    ValDtls: {
      AssVal: Number(inv.subtotal) || 0,
      CgstVal: Number(inv.cgst_total) || 0,
      SgstVal: Number(inv.sgst_total) || 0,
      IgstVal: Number(inv.igst_total) || 0,
      CessVal: Number(inv.cess_total) || 0,
      OthChrg: Number(inv.discount || 0) * -1,
      RndOffAmt: Number(inv.round_off || 0),
      TotInvVal: Number(inv.grand_total) || 0,
      TotInvValFc: Number(inv.grand_total) || 0,
    },
    PayDtls: {
      Nm: 'TriVista',
      Mode: inv.payment_mode === 'CREDIT' ? 'OTHER' : inv.payment_mode,
      PayTerm: 'NET',
      PaymtDet: company.bank_account_no || '',
    },
    ExpDtls: null,
    EwbDtls: null,
    AddlDocDtls: null,
  };
}

/**
 * Generate e-Invoice JSON for an invoice (no external call yet - sandbox ready).
 */
async function generateEinvoice(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const pool = getPool();
    const [ex] = await pool.query('SELECT * FROM einvoice_logs WHERE invoice_id=? ORDER BY id DESC LIMIT 1', [invId]);
    const payload = await buildEinvoicePayload(invId);
    const [invRows] = await pool.query('SELECT invoice_number FROM invoices WHERE id=?', [invId]);

    if (!ex.length) {
      await pool.query(
        `INSERT INTO einvoice_logs (invoice_id,status,raw_request)
         VALUES (?,'PENDING',?)`,
        [invId, JSON.stringify(payload)]
      );
    } else if (ex[0].status === 'PENDING') {
      await pool.query(`UPDATE einvoice_logs SET raw_request=? WHERE id=?`, [JSON.stringify(payload), ex[0].id]);
    }

    // Sandbox URL hook (set INTEGRATION_EINVOICE_URL in .env). No external call without creds.
    await audit(req, 'EINVOICE_GENERATE', 'invoice', invId, { invoice_number: invRows[0]?.invoice_number || null });
    res.json({
      message: 'e-Invoice JSON generated (GSTN 1.03). Submit via your IRP portal e.g. Wavez/Vayana/NSDL with your creds.',
      payload,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Simulate IRN generation (sandbox). Maps invoice -> IRN + Ack.
 */
async function simulateIrn(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const pool = getPool();
    const payload = await buildEinvoicePayload(invId);
    const [invRows] = await pool.query('SELECT invoice_number FROM invoices WHERE id=?', [invId]);
    const irn = 'SANDBOX' + '2026' + String(invId).padStart(12, '0');
    const ack = 'ACK' + String(Math.floor(Math.random() * 9e8) + 1e8);
    await pool.query(
      `INSERT INTO einvoice_logs (invoice_id,irn,ack_number,ack_date,status,signed_invoice,raw_request)
       VALUES (?,?,?,NOW(),'GENERATED',?,?)`,
      [invId, irn, ack, JSON.stringify(payload), JSON.stringify(payload)]
    );
    await pool.query("UPDATE invoices SET irn=? WHERE id=?", [irn, invId]);
    await audit(req, 'EINVOICE_GENERATED', 'invoice', invId, { irn, invoice_number: invRows[0]?.invoice_number || null });
    res.json({ irn, ack_number: ack, message: 'Simulated IRN generated (sandbox).' });
  } catch (e) {
    next(e);
  }
}

/**
 * Submit Invoice to the real IRP (NSDL/Wavez/Vayana etc.) using QR-Salt-IRN
 * style payload and store the returned IRN + QR code.
 * Set IRP_ENDPOINT (+ optional IRP_AUTH) in backend/.env to go live.
 */
async function submitIrn(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const pool = getPool();
    const payload = await buildEinvoicePayload(invId);
    const [invRow] = await pool.query('SELECT invoice_type FROM invoices WHERE id=?', [invId]);
    const invType = invRow[0]?.invoice_type || 'B2B';

    // Live IRP does not (yet) accept credit/debit notes or nil-rated documents.
    if (['CREDIT_NOTE', 'DEBIT_NOTE', 'NIL'].includes(invType)) {
      return res.status(400).json({
        error: `${invType} is not e-invoice ready. File credit/debit notes manually in the GST portal for now.`,
        expose: true,
      });
    }

    const [co] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = co[0] || {};

    const endpoint = (process.env.IRP_ENDPOINT || '').trim();
    if (!endpoint) {
      return res.status(400).json({ error: 'IRP_ENDPOINT not configured. Run sandbox simulate for testing first.' });
    }

    const authHeader = (process.env.IRP_AUTH || '').trim();
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), 40000)
      : null;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
    });
    if (timer) clearTimeout(timer);
    const text = await resp.text();
    let data = {};
    try { data = JSON.parse(text); } catch (e) { /* IRP may answer non-JSON on error */ }

    const statusOk = String(data.Status) === '1' || (data.Irn || (data.EwbNo && payload.EwbDtls) || resp.ok && data.Irn);
    const rawRespJson = JSON.stringify(text).slice(0, 4000);
    if (!statusOk) {
      await pool.query(
        `INSERT INTO einvoice_logs (invoice_id,status,raw_request,raw_response) VALUES (?,'FAILED',?,?)`,
        [invId, JSON.stringify(payload), rawRespJson]
      );
      await audit(req, 'EINVOICE_FAIL', 'invoice', invId, { error: text.slice(0, 1000), invoice_number: null });
      return res.status(502).json({ error: 'IRP submission failed', detail: text.slice(0, 1000) });
    }

    const irn = data.Irn || data.irn || '';
    const ack = data.AckNo || data.ackNo || '';
    const ackDate = data.AckDt || data.ackDt || new Date().toISOString().slice(0, 10);
    const signed = data.SignedInvoice || JSON.stringify(data) || JSON.stringify(payload);

    let qrUrl = null;
    if (irn) {
      const QRCode = require('qrcode');
      const qrText = `I${irn}|S${company.gstin || ''}|B${payload.BuyerDtls.Gstin}|N${payload.DocDtls.No}|D${payload.DocDtls.Dt}`;
      qrUrl = await QRCode.toDataURL(qrText).catch(() => null);
    }

    await pool.query(
      `INSERT INTO einvoice_logs (invoice_id,irn,ack_number,ack_date,status,signed_invoice,raw_request,raw_response,qr_url)
       VALUES (?,?,?,?, 'GENERATED',?,?,?,?)`,
      [invId, irn || null, ack || null, ackDate, signed, JSON.stringify(payload), rawRespJson, qrUrl]
    );
    await pool.query('UPDATE invoices SET irn=? WHERE id=?', [irn || null, invId]);
    await audit(req, 'EINVOICE_GENERATED', 'invoice', invId, { irn, invoice_number: inv.invoice_number });
    res.json({ irn, ack_number: ack, ack_date: ackDate, qr_url: qrUrl, message: 'IRN generated and QR prepared.' });
  } catch (e) {
    next(e);
  }
}

async function einvoiceLogs(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT el.*, i.invoice_number,i.grand_total,i.customer_name FROM einvoice_logs el
       JOIN invoices i ON i.id=el.invoice_id ORDER BY el.id DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

// ---------------- e-Way Bill ----------------
async function ewaybillLogs(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT el.*, i.invoice_number,i.grand_total FROM ewaybill_logs el
       JOIN invoices i ON i.id=el.invoice_id ORDER BY el.id DESC LIMIT 100`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Build the e-Way Bill payload (GSTN EWB schema, simplified) for an invoice.
 */
async function buildEwayPayload(pool, invId, b) {
  const [invRows] = await pool.query(
    `SELECT i.*, c.state_code AS cust_state FROM invoices i
     LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, [invId]
  );
  if (!invRows.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
  const inv = invRows[0];
  const [co] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
  const company = co[0] || {};
  const [items] = await pool.query(
    `SELECT ii.*, p.weight_kg FROM invoice_items ii LEFT JOIN products p ON p.id=ii.product_id WHERE ii.invoice_id=?`,
    [invId]
  );

  const totalWeight = items.reduce((s, it) => {
    const kg = Number(it.weight_kg) || 0;
    return s + (Number(it.quantity) || 0) * kg;
  }, 0);

  return {
    Vers: 1,
    EwbNo: null,
    EwbDtls: {
      VehNo: b.vehicle_no || '',
      Dist: Number(b.distance_km) || 0,
      FromPlace: company.city || '',
      FromPincode: company.pincode || '',
      HsnWise: items.map((it) => ({ HsnCd: it.hsn_code || '', Qty: Number(it.quantity) || 0, Unit: it.unit || 'KGS', TaxableVal: Number(it.taxable_value) || 0 })).filter((x) => x.HsnCd),
      TotalValue: Number(inv.grand_total) || 0,
      TotKg: totalWeight,
      TransporterId: b.transporter_gstin || '',
      TransDocNo: b.gcn_no || '',
      TransMode: b.transporter_mode || '1',
    },
    BuyerGstin: inv.customer_gstin || 'URP',
    BuyerState: inv.place_of_supply || inv.cust_state || '',
    DocNo: inv.invoice_number,
    DocDate: inv.invoice_date,
    FromGstin: company.gstin || '',
    FromState: company.state_code || '',
  };
}

async function generateEwaybill(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const b = req.body || {};
    const pool = getPool();
    const payload = await buildEwayPayload(pool, invId, b);
    const [invRows] = await pool.query('SELECT invoice_number FROM invoices WHERE id=?', [invId]);

    // Sandbox: no numeric assignment without real API creds.
    await pool.query(
      `INSERT INTO ewaybill_logs (invoice_id,status,transporter_name,vehicle_no,raw_request)
       VALUES (?,'PENDING',?,?,?)`,
      [invId, b.transporter_name || null, b.vehicle_no || null, JSON.stringify(payload)]
    );
    await audit(req, 'EWAYBILL_GENERATE', 'invoice', invId, { invoice_number: invRows[0]?.invoice_number || null, distance_km: Number(b.distance_km) || 0 });

    res.json({
      message: 'e-Way Bill JSON prepared. Submit via GSTN e-Way Bill API or the official portal with your transporter token.',
      payload,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/integration/ewaybill/:id/submit
 * Submits the e-Way Bill to the live GSTN endpoint when EWB_ENDPOINT is
 * configured; otherwise errors out to offline/sandbox mode.
 */
async function submitEway(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const b = req.body || {};
    const pool = getPool();
    const payload = await buildEwayPayload(pool, invId, b);
    const [invRows] = await pool.query('SELECT invoice_number FROM invoices WHERE id=?', [invId]);

    const endpoint = (process.env.EWB_ENDPOINT || '').trim();
    if (!endpoint) {
      return res.status(400).json({ error: 'EWB_ENDPOINT not configured. Run the offline generate for a sandbox payload.' });
    }
    const authHeader = (process.env.EWB_AUTH || '').trim();

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 40000) : null;
    let resp, text = '';
    try {
      resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined,
      });
      if (timer) clearTimeout(timer);
      text = await resp.text();
    } catch (err) {
      if (timer) clearTimeout(timer);
      await pool.query(
        `INSERT INTO ewaybill_logs (invoice_id,status,raw_request,raw_response,transporter_name,vehicle_no)
         VALUES (?,'FAILED',?,?,?,?)`,
        [invId, JSON.stringify(payload), JSON.stringify({ error: String(err.message).slice(0, 1000) }), b.transporter_name || null, b.vehicle_no || null]
      );
      await audit(req, 'EWAYBILL_FAIL', 'invoice', invId, { error: String(err.message).slice(0, 500), invoice_number: invRows[0]?.invoice_number || null });
      return res.status(502).json({ error: 'e-Way Bill submission failed', detail: String(err.message).slice(0, 500) });
    }
    let data = {};
    try { data = JSON.parse(text); } catch (e) { /* EWB may answer non-JSON on error */ }

    const ewbNo = data.EwbNo || data.EwbNo_ewbNo || data.ewbNo || data.Data?.EwbNo || null;
    const statusOk = !!ewbNo || String(data.Status) === '1';
    if (!statusOk) {
      await pool.query(
        `INSERT INTO ewaybill_logs (invoice_id,status,raw_request,raw_response,transporter_name,vehicle_no)
         VALUES (?,'FAILED',?,?,?,?)`,
        [invId, JSON.stringify(payload), JSON.stringify(text).slice(0, 4000), b.transporter_name || null, b.vehicle_no || null]
      );
      await audit(req, 'EWAYBILL_FAIL', 'invoice', invId, { error: text.slice(0, 1000), invoice_number: invRows[0]?.invoice_number || null });
      return res.status(502).json({ error: 'e-Way Bill submission failed', detail: text.slice(0, 1000) });
    }

    await pool.query(
      `INSERT INTO ewaybill_logs (invoice_id,ewb_no,status,transporter_name,vehicle_no,raw_request,raw_response)
       VALUES (?,?,'GENERATED',?,?,?,?)`,
      [invId, ewbNo, b.transporter_name || null, b.vehicle_no || null, JSON.stringify(payload), JSON.stringify(text).slice(0, 4000)]
    );
    await audit(req, 'EWAYBILL_GENERATED', 'invoice', invId, { ewb_no: ewbNo, invoice_number: invRows[0]?.invoice_number || null });
    res.json({ ewb_no: ewbNo, message: 'e-Way Bill generated at the GST portal.' });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/integration/status
 * Lightweight live/offline spec for IRP & e-Way based on configured creds
 * (no secrets returned). The UI shows LIVE / OFFLINE badges from this.
 */
async function status(req, res, next) {
  try {
    const strip = (k) => (process.env[k] || '').trim();
    res.json({
      irp: {
        enabled: !!strip('IRP_ENDPOINT'),
        endpoint: strip('IRP_ENDPOINT'),
        auth_set: !!strip('IRP_AUTH'),
        cancel_endpoint_set: !!strip('IRP_CANCEL_ENDPOINT'),
      },
      ewb: {
        enabled: !!strip('EWB_ENDPOINT'),
        endpoint: strip('EWB_ENDPOINT'),
        auth_set: !!strip('EWB_AUTH'),
      },
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { buildEinvoicePayload, generateEinvoice, simulateIrn, submitIrn, einvoiceLogs, generateEwaybill, submitEway, ewaybillLogs, status, getSettings, saveSettings };