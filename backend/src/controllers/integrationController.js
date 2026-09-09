const { getPool } = require('../db');

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
    const irn = 'SANDBOX' + '2026' + String(invId).padStart(12, '0');
    const ack = 'ACK' + String(Math.floor(Math.random() * 9e8) + 1e8);
    await pool.query(
      `INSERT INTO einvoice_logs (invoice_id,irn,ack_number,ack_date,status,signed_invoice,raw_request)
       VALUES (?,?,?,NOW(),'GENERATED',?,?)`,
      [invId, irn, ack, JSON.stringify(payload), JSON.stringify(payload)]
    );
    await pool.query("UPDATE invoices SET irn=? WHERE id=?", [irn, invId]);
    res.json({ irn, ack_number: ack, message: 'Simulated IRN generated (sandbox).' });
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
async function generateEwaybill(req, res, next) {
  try {
    const invId = Number(req.params.id);
    const b = req.body || {};
    const pool = getPool();
    const [invRows] = await pool.query(
      `SELECT i.*, c.state_code AS cust_state FROM invoices i
       LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=?`, [invId]
    );
    if (!invRows.length) return res.status(404).json({ error: 'Invoice not found.' });
    const inv = invRows[0];
    const [co] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = co[0] || {};
    const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=?', [invId]);

    const totalWeight = items.reduce((s, it) => s + (Number(it.quantity) || 0) * 1.5, 0);

    const payload = {
      Vers: 1,
      EwbNo: null,
      EwbDtls: {
        VehNo: b.vehicle_no || '',
        FromPlace: company.city || '',
        FromPincode: company.pincode || '',
        HsnWise: items.map((it) => ({ HsnCd: it.hsn_code || '', Qty: Number(it.quantity) || 0, Unit: 'KGS', TaxableVal: Number(it.taxable_value) || 0 })).filter((x)=>x.HsnCd),
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

    // Sandbox: no numeric assignment without real API creds.
    await pool.query(
      `INSERT INTO ewaybill_logs (invoice_id,status,transporter_name,vehicle_no,raw_request)
       VALUES (?,'PENDING',?,?,?)`,
      [invId, b.transporter_name || null, b.vehicle_no || null, JSON.stringify(payload)]
    );

    res.json({
      message: 'e-Way Bill JSON prepared. Submit via GSTN e-Way Bill API or the official portal with your transporter token.',
      payload,
    });
  } catch (e) {
    next(e);
  }
}

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

module.exports = { buildEinvoicePayload, generateEinvoice, simulateIrn, einvoiceLogs, generateEwaybill, ewaybillLogs };