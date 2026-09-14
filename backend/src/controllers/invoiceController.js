const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { localDateStr } = require('../utils/helpers');
const { allocateInvoiceNumber } = require('../utils/invoiceNumber');
const { getActiveBranch } = require('../utils/branch');
const { computeTcs } = require('../utils/tds');
const { resolveRateForDate } = require('../utils/rateHistory');
const { enforceDiscountLimit } = require('../utils/discountPolicy');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');
const lots = require('../utils/lots');
const payments = require('../utils/payments');

/**
 * Create a GST invoice with full tax computation.
 * body: {
 *   customer_id, invoice_date, due_date,
 *   place_of_supply (2-digit) optional (defaults to customer.state_code or company state),
 *   payment_mode, notes,
 *   items: [{ product_id?, item_name, hsn_code, quantity, unit, unit_price, discount, gst_rate }]
 * }
 */
/**
 * Shared invoice builder used by the API and recurring invoicing.
 * Must run inside an open transaction (conn). Does NOT commit — caller commits.
 * Returns { customer_id, resp: { id, invoice_number, grand_total, message } }.
 */
async function createInvoiceCore(conn, user, b) {
  if (!b.customer_id) throw Object.assign(new Error('customer_id is required.'), { status: 400 });
  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw Object.assign(new Error('At least one item is required.'), { status: 400 });
  }

  // Active branch drives state code + billing series
  const branch = await getActiveBranch(conn);
  const [cRows] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
  const company = cRows[0] || {};
  const companyState = branch?.state_code || company.state_code || '29';

  // Back-dating guard: dates other than today must be explicitly confirmed
  const todayIso = localDateStr();
  const invDate = b.invoice_date || todayIso;
  if (invDate !== todayIso && !b.allow_backdate) {
    throw Object.assign(new Error('This invoice is backdated. Send allow_backdate:true with a reason in notes to proceed.'), { status: 400, expose: true });
  }

  // Fetch customer (needed for default document type / place of supply)
  const [custRows] = await conn.query('SELECT * FROM customers WHERE id=?', [b.customer_id]);
  if (!custRows.length) throw Object.assign(new Error('Customer not found.'), { status: 404 });
  const customer = custRows[0];

  // Document type: Tax Invoice B2B/B2C (default from party registration category), or
  // CREDIT_NOTE / DEBIT_NOTE / EXPORT / NIL (exempt)
  const DOC_TYPES = ['B2B', 'B2C', 'CREDIT_NOTE', 'DEBIT_NOTE', 'EXPORT', 'NIL'];
  const requestedType = String(b.invoice_type || '').toUpperCase();
  const regCategory = customer.registration_category || (customer.gstin ? 'registered' : 'unregistered');
  const defaultType = regCategory === 'export' ? 'EXPORT' : regCategory === 'unregistered' ? 'B2C' : 'B2B';
  const invoiceType = DOC_TYPES.includes(requestedType)
    ? requestedType
    : defaultType;
  const isCreditDoc = invoiceType === 'CREDIT_NOTE' || invoiceType === 'DEBIT_NOTE';
  const isRestockDoc = invoiceType === 'CREDIT_NOTE';
  const isNilDoc = invoiceType === 'NIL';
  const isExportDoc = invoiceType === 'EXPORT';
  const sign = isCreditDoc ? -1 : 1;
  // Tax-exempt party: nil-rated supply keeps its taxable value but carries no GST.
  const isExempt = customer.tax_exempt && !isExportDoc;

  // Credit/debit notes reference the tax invoice they adjust (GSTR-1 Table 8A/9B:
  // CDNR carries the original invoice number/date = inum/idt).
  let againstInvoiceNo = null;
  if (isCreditDoc && b.original_invoice_id) {
    const [orig] = await conn.query('SELECT * FROM invoices WHERE id=?', [Number(b.original_invoice_id)]);
    if (!orig.length) throw Object.assign(new Error('Original invoice not found.'), { status: 400, expose: true });
    const originalInv = orig[0];
    if (Number(originalInv.customer_id) !== Number(customer.id)) {
      throw Object.assign(new Error('Original invoice belongs to a different customer.'), { status: 400, expose: true });
    }
    if (originalInv.status === 'CANCELLED') {
      throw Object.assign(new Error('Cannot link a credit/debit note to a cancelled invoice.'), { status: 400, expose: true });
    }
    againstInvoiceNo = originalInv.invoice_number;
  } else if (isCreditDoc && b.against_invoice_no) {
    againstInvoiceNo = String(b.against_invoice_no).trim() || null;
  }

  // Atomically allocate next invoice number (gap-less per FY, per branch)
  const invoiceNumber = await allocateInvoiceNumber(conn, branch, invDate);

  const placeOfSupply = b.place_of_supply || customer.state_code || companyState;
  const isInterstate = String(placeOfSupply) !== String(companyState);

  let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, utgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;
  const itemRows = [];
  const saleMoveIds = [];
  const restockMoveIds = [];

  for (const it of b.items) {
    const qty = Number(it.quantity) || 1;
    const rate = Number(it.unit_price) || 0;
    const disc = Number(it.discount) || 0;
    // Product master carries the HSN/SAC when the line omits it (API consumers).
    let productRow = null;
    if (it.product_id) {
      const [p] = await conn.query('SELECT name, hsn_code, cess_rate, is_service, track_batch, track_serial FROM products WHERE id=?', [it.product_id]);
      if (p.length) productRow = p[0];
    }
    // Effective-dated rate: resolve the statutory GST rate for the HSN/SAC on
    // the invoice date (never hard-coded). Client-supplied rate is only the
    // fallback for manual lines without a resolvable HSN.
    const resolved = await resolveRateForDate(conn, {
      hsnCode: it.hsn_code || productRow?.hsn_code || null,
      date: invDate,
      fallbackRate: Number(it.gst_rate) || 0,
    });
    let gstRate = resolved.gst_rate;
    // Compensation cess: client line > product override > dated HSN history.
    const cessRate = it.cess_rate !== undefined
      ? Number(it.cess_rate) || 0
      : productRow?.cess_rate != null ? Number(productRow.cess_rate) || 0 : Number(resolved.cess_rate) || 0;
    const gross = qty * rate;
    let taxableValue = gross - disc;
    // Nil/exempt documents carry no tax (portal reports taxable position separately).
    // Exports carry the value but zero tax.
    if (isNilDoc) {
      gstRate = 0;
      taxableValue = 0;
    }
    const tax = isNilDoc || isExportDoc || isExempt
      ? { cgst: 0, sgst: 0, utgst: 0, igst: 0, cess: 0 }
      : splitGst(taxableValue, gstRate, placeOfSupply, companyState, cessRate);
    const lineTotal = (taxableValue + tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess) * sign;

    subtotal += gross * sign;
    discountTotal += disc * sign;
    cgstTotal += tax.cgst * sign;
    sgstTotal += tax.sgst * sign;
    utgstTotal += tax.utgst * sign;
    igstTotal += tax.igst * sign;
    cessTotal += tax.cess * sign;
    taxTotal += (tax.cgst + tax.sgst + tax.utgst + tax.igst + tax.cess) * sign;
    grandTotal += lineTotal;

    itemRows.push({
      product_id: it.product_id || null,
      item_name: it.item_name ?? productRow?.name ?? null,
      hsn_code: it.hsn_code || productRow?.hsn_code || null,
      gst_rate: gstRate,
      quantity: qty,
      unit: it.unit || 'PCS',
      unit_price: rate,
      discount: disc,
      taxable_value: round2(taxableValue * sign),
      cgst_amount: tax.cgst * sign,
      sgst_amount: tax.sgst * sign,
      utgst_amount: tax.utgst * sign,
      igst_amount: tax.igst * sign,
      cess_amount: tax.cess * sign,
      total: round2(lineTotal),
    });

    // Stock handling: OUT on sale, IN (restock) on credit notes only. Services
    // never issue stock. Debit notes adjust money, not goods — no movement.
    if (productRow) {
      const track = { track_batch: productRow.track_batch, track_serial: productRow.track_serial };
      if (productRow.is_service) {
        if (isRestockDoc) {
          const m = await lots.recordIn(conn, {
            product_id: it.product_id, qty, unit_cost: null,
            note: `Credit note ${invoiceNumber} restock`, created_by: user.id,
            reference_type: 'credit_note', reference_id: null, track,
          });
          restockMoveIds.push(m);
        }
      } else if (isRestockDoc) {
        let batchId = null;
        if (it.batch_no || productRow.track_batch) {
          batchId = await lots.getOrCreateLot(conn, {
            product_id: it.product_id, batch_no: it.batch_no || `RESTOCK-${String(invoiceNumber).slice(-6)}`,
            expiry_date: it.expiry_date, mfg_date: it.mfg_date, created_by: user.id,
          });
        }
        const m = await lots.recordIn(conn, {
          product_id: it.product_id, qty, unit_cost: null,
          note: `Credit note ${invoiceNumber} restock`, created_by: user.id,
          reference_type: 'credit_note', reference_id: null,
          track: { ...track, batch_id: batchId, serial_numbers: it.serial_numbers },
        });
        restockMoveIds.push(m);
      } else if (invoiceType === 'DEBIT_NOTE') {
        // Debit notes carry no goods movement (Rule 47/48: money adjustment only).
      } else {
        const inserted = await lots.issueForSale(conn, {
          product_id: it.product_id, qty,
          note: `Invoice ${invoiceNumber}`, created_by: user.id,
          reference_type: 'invoice', reference_id: null,
        });
        saleMoveIds.push(...inserted.map((m) => m.id));
      }
    }
  }

  // Round off
  let roundOff = 0;
  if (Number(company.round_off) === 1) {
    const rounded = Math.round(grandTotal);
    roundOff = round2(rounded - grandTotal);
    grandTotal = rounded;
  }
  grandTotal = round2(grandTotal);

  // Staff discount approval limit (ADMIN/SUPER_ADMIN are the approvers)
  enforceDiscountLimit({ user, company, subtotal, discount: discountTotal });

  // TCS u/s 206C(1H) on the FY-cumulative sales value above the threshold
  const tcsAmount = await computeTcs(
    conn, customer.id, invDate,
    round2(subtotal - discountTotal), 0, company
  );

const [ins] = await conn.query(
    `INSERT INTO invoices
     (invoice_number,invoice_date,due_date,customer_id,customer_name,customer_gstin,invoice_type,
      original_invoice_id,against_invoice_no,place_of_supply,is_interstate,status,subtotal,discount,cgst_total,sgst_total,utgst_total,igst_total,cess_total,
      tax_total,round_off,grand_total,paid_amount,balance_due,payment_mode,tcs_amount,notes,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      invoiceNumber,
      invDate,
      b.due_date || null,
      customer.id,
      customer.name,
      customer.gstin || null,
      invoiceType,
      b.original_invoice_id ? Number(b.original_invoice_id) : null,
      againstInvoiceNo,
      placeOfSupply,
      isInterstate ? 1 : 0,
      'PENDING',
      round2(subtotal),
      round2(discountTotal),
      round2(cgstTotal),
      round2(sgstTotal),
      round2(utgstTotal),
      round2(igstTotal),
      round2(cessTotal),
      round2(taxTotal),
      roundOff,
      grandTotal,
      0,
      grandTotal,
      b.payment_mode || 'CREDIT',
      tcsAmount,
      b.notes || null,
      user.id,
    ]
  );
  const invoiceId = ins.insertId;

  if (saleMoveIds.length) {
    const ph = saleMoveIds.map(() => '?').join(',');
    await conn.query(`UPDATE stock_movements SET reference_id=? WHERE id IN (${ph})`, [invoiceId, ...saleMoveIds]);
  }
  if (restockMoveIds.length) {
    const ph = restockMoveIds.map(() => '?').join(',');
    await conn.query(`UPDATE stock_movements SET reference_id=? WHERE id IN (${ph})`, [invoiceId, ...restockMoveIds]);
  }

  for (const it of itemRows) {
    await conn.query(
      `INSERT INTO invoice_items
       (invoice_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
        taxable_value,cgst_amount,sgst_amount,utgst_amount,igst_amount,cess_amount,total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceId, it.product_id, it.item_name, it.hsn_code, it.gst_rate, it.quantity, it.unit,
        it.unit_price, it.discount, it.taxable_value, it.cgst_amount, it.sgst_amount,
        it.utgst_amount, it.igst_amount, it.cess_amount, it.total,
      ]
    );
  }

  // Record any payment(s) — single mode or split (cash + UPI, etc.)
  let paidAmount = 0;
  const legs = payments.parsePayments(b).legs;
  if (legs.length) {
    const capped = payments.capLegs(legs, grandTotal);
    if (capped.legs.length) {
      paidAmount = capped.total;
      await payments.recordInvoicePayments(conn, {
        invoice: { id: invoiceId, invoice_number: invoiceNumber, customer_id: customer.id },
        customer_id: customer.id,
        legs: capped.legs,
        date: b.invoice_date || localDateStr(),
        created_by: user.id,
      });
    }
  }
  const status = paidAmount >= grandTotal ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
  const balance = round2(grandTotal - paidAmount);
  await conn.query(
    'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
    [paidAmount, balance, status, invoiceId]
  );

  // Post double-entry ledgers (idempotent by voucher number)
  await ledger.postSale(conn, {
    id: invoiceId,
    invoice_number: invoiceNumber,
    invoice_date: invDate,
    customer_name: customer.name,
    grand_total: grandTotal,
    subtotal: round2(subtotal),
    cgst_total: round2(cgstTotal),
    sgst_total: round2(sgstTotal),
    utgst_total: round2(utgstTotal),
    igst_total: round2(igstTotal),
    cess_total: round2(cessTotal),
  }, user.id);

  return {
    customer_id: customer.id,
    resp: { id: invoiceId, invoice_number: invoiceNumber, grand_total: grandTotal, message: 'Invoice created.' },
  };
}

async function create(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await createInvoiceCore(conn, req.user, req.body || {});
    await conn.commit();
    await refreshCustomerBalance(conn, result.customer_id);
    await audit(req, 'CREATE', 'invoice', result.resp.id, {
      invoice_number: result.resp.invoice_number,
      customer_id: result.customer_id,
      grand_total: result.resp.grand_total,
    });
    res.status(201).json(result.resp);
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

/**
 * List invoices with summary + item lines.
 */
async function list(req, res, next) {
  try {
    const { q, status, from, to, customer_id, page = 1, limit = 20 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (q) where.push('(i.invoice_number LIKE ? OR i.customer_name LIKE ?)'), params.push(`%${q}%`, `%${q}%`);
    if (status) where.push('i.status = ?'), params.push(status);
    if (from) where.push('i.invoice_date >= ?'), params.push(from);
    if (to) where.push('i.invoice_date <= ?'), params.push(to);
    if (customer_id) where.push('i.customer_id = ?'), params.push(Number(customer_id));
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);

    const [rows] = await pool.query(
      `SELECT i.*, c.name AS customer_display
       FROM invoices i LEFT JOIN customers c ON c.id=i.customer_id
       ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM invoices i ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

async function get(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT i.*, (SELECT l.qr_url FROM einvoice_logs l WHERE l.invoice_id=i.id ORDER BY l.id DESC LIMIT 1) AS qr_url
       FROM invoices i WHERE i.id=?`,
      [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Invoice not found.' });
    const [items] = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY id', [rows[0].id]);
    const [payments] = await pool.query('SELECT * FROM payments WHERE invoice_id=? ORDER BY id', [rows[0].id]);
    const [customer] = await pool.query('SELECT * FROM customers WHERE id=?', [rows[0].customer_id]);
    const [company] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    res.json({ ...rows[0], items, payments, customer: customer[0] || null, company: company[0] || null });
  } catch (e) {
    next(e);
  }
}

/**
 * Record payment against an invoice.
 */
async function addPayment(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const invoiceId = Number(req.params.id);
    const { date, note } = req.body || {};
    const legs = payments.parsePayments(req.body || {}).legs;
    if (!legs.length) return res.status(400).json({ error: 'Valid amount required.' });

    await conn.beginTransaction();
    const [inv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
    if (!inv.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
    const invoice = inv[0];
    if (invoice.status === 'CANCELLED') throw Object.assign(new Error('Cannot pay a cancelled invoice.'), { status: 400 });

    const pending = Number(invoice.balance_due);
    const capped = payments.capLegs(legs, pending);
    if (capped.total <= 0) return res.status(400).json({ error: 'Valid amount required.' });

    const payDate = date || localDateStr();
    await payments.recordInvoicePayments(conn, {
      invoice,
      customer_id: invoice.customer_id,
      legs: capped.legs,
      date: payDate,
      created_by: req.user.id,
    });

    const newPaid = round2(Number(invoice.paid_amount) + capped.total);
    const due = round2(pending - capped.total);
    const status = due === 0 ? 'PAID' : 'PARTIAL';
    await conn.query(
      'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [newPaid, due, status, invoice.id]
    );
    await refreshCustomerBalance(conn, invoice.customer_id);
    await conn.commit();
    await audit(req, 'PAY', 'payment', invoiceId, {
      amount: capped.total,
      modes: capped.legs.map((l) => `${l.mode}:${l.amount}`),
      invoice_number: invoice.invoice_number,
    });
    res.json({ message: 'Payment recorded.', balance_due: due, paid: capped.total });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

/**
 * Cancel an invoice (restore stock).
 */
async function cancel(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const invoiceId = Number(req.params.id);
    const reason = String(req.body?.reason || '').trim() || 'Cancelled';
    await conn.beginTransaction();
    const [inv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
    if (!inv.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
    const invoice = inv[0];
    if (invoice.status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled.' });

    // If this invoice has a live IRN, cancel it at the IRP first (24-hour window).
    // Without IRP_CANCEL_ENDPOINT configured, we cancel locally and flag the note.
    let irpStatus = null;
    if (invoice.irn) {
      const cancelEndpoint = (process.env.IRP_CANCEL_ENDPOINT || '').trim();
      if (cancelEndpoint) {
        const authHeader = (process.env.IRP_AUTH || '').trim();
        const cancelPayload = {
          Irn: invoice.irn,
          Cnlrsn: reason.length > 190 ? reason.slice(0, 190) : reason,
          Cnlrem: reason,
        };
        try {
          const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), 40000) : null;
          const resp = await fetch(cancelEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) },
            body: JSON.stringify(cancelPayload),
            signal: controller ? controller.signal : undefined,
          });
          if (timer) clearTimeout(timer);
          const text = await resp.text();
          let data = {};
          try { data = JSON.parse(text); } catch (e) { /* ignore */ }
          if (!resp.ok && !data.Irn && String(data.Status) !== '1') {
            throw new Error(`IRP cancel failed: ${text.slice(0, 300)}`);
          }
          irpStatus = 'IRN_CANCELLED';
          await conn.query(
            `INSERT INTO einvoice_logs (invoice_id,irn,status,raw_request,raw_response)
             VALUES (?,?,'IRN_CANCELLED',?,?)`,
            [invoiceId, invoice.irn, JSON.stringify(cancelPayload), text.slice(0, 1000)]
          );
        } catch (err) {
          await conn.query(
            `INSERT INTO einvoice_logs (invoice_id,irn,status,raw_request,raw_response)
             VALUES (?,?,'IRN_CANCEL_FAILED',?,?)`,
            [invoiceId, invoice.irn, JSON.stringify(cancelPayload), String(err.message).slice(0, 1000)]
          );
          throw Object.assign(new Error(`Cannot cancel invoice because its IRN is still live. ${err.message}`), { status: 502, expose: true, retainError: true });
        }
      } else {
        irpStatus = 'LOCAL_ONLY';
      }
    }

    // Restore stock (returned lines go back to their exact lots, serials intact)
    let restored = await lots.restoreForCancelledInvoice(conn, {
      reference_id: invoiceId, created_by: req.user.id,
    });
    if (!restored) {
      // Legacy invoices created before movement-referencing: line-level fallback.
      restored = await lots.restoreLegacy(conn, { invoice_id: invoiceId, created_by: req.user.id });
    }
    const notes = invoice.notes ? `${invoice.notes}\nCANCELLED: ${reason}` : `CANCELLED: ${reason}`;
    await conn.query(
      "UPDATE invoices SET status='CANCELLED', balance_due=0, notes=? WHERE id=?",
      [notes, invoiceId]
    );

    // Reverse the sale ledger and any payment vouchers (mirror entries)
    const reversalDate = localDateStr();
    await ledger.postReversal(conn, {
      voucher_no: `INV-${invoice.invoice_number}`,
      date: reversalDate,
      narration: `Cancelled invoice ${invoice.invoice_number}`,
      created_by: req.user.id,
    });
    const [invPayments] = await conn.query('SELECT id FROM payments WHERE invoice_id=?', [invoiceId]);
    for (const p of invPayments) {
      await ledger.postReversal(conn, {
        voucher_no: `P-INV-${p.id}`,
        date: reversalDate,
        narration: `Refund reversal on cancelled invoice ${invoice.invoice_number}`,
        created_by: req.user.id,
      });
    }

    await refreshCustomerBalance(conn, invoice.customer_id);
    await conn.commit();
    await audit(req, 'CANCEL', 'invoice', invoiceId, {
      invoice_number: invoice.invoice_number,
      reason,
      irp: irpStatus,
    });
    res.json({
      message: 'Invoice cancelled and stock restored.',
      irn_cancelled: irpStatus === 'IRN_CANCELLED',
      irp_status: irpStatus,
    });
  } catch (e) {
    await conn.rollback();
    if (e instanceof Error && e.expose) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally {
    conn.release();
  }
}

/**
 * Recompute a customer's receivable balance from non-cancelled invoices.
 */
async function refreshCustomerBalance(conn, customerId) {
  const [rows] = await conn.query(
    `SELECT IFNULL(SUM(balance_due),0) AS due FROM invoices
     WHERE customer_id=? AND status NOT IN ('CANCELLED','PAID')`,
    [customerId]
  );
  if (rows.length) {
    await conn.query(
      'UPDATE customers SET outstanding_balance=? WHERE id=?',
      [round2(rows[0].due), customerId]
    );
  }
}

module.exports = { create, createInvoiceCore, list, get, addPayment, cancel, refreshCustomerBalance };