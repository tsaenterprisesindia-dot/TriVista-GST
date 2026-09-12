const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { localDateStr } = require('../utils/helpers');
const { allocateInvoiceNumber } = require('../utils/invoiceNumber');
const { getActiveBranch } = require('../utils/branch');
const { computeTcs } = require('../utils/tds');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');

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
  const isNilDoc = invoiceType === 'NIL';
  const isExportDoc = invoiceType === 'EXPORT';
  const sign = isCreditDoc ? -1 : 1;
  // Tax-exempt party: nil-rated supply keeps its taxable value but carries no GST.
  const isExempt = customer.tax_exempt && !isExportDoc;

  // Atomically allocate next invoice number (gap-less per FY, per branch)
  const invoiceNumber = await allocateInvoiceNumber(conn, branch, invDate);

  const placeOfSupply = b.place_of_supply || customer.state_code || companyState;
  const isInterstate = String(placeOfSupply) !== String(companyState);

  let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, utgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;
  const itemRows = [];

  for (const it of b.items) {
    const qty = Number(it.quantity) || 1;
    const rate = Number(it.unit_price) || 0;
    const disc = Number(it.discount) || 0;
    let gstRate = Number(it.gst_rate) || 0;
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
      : splitGst(taxableValue, gstRate, placeOfSupply, companyState);
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
      item_name: it.item_name,
      hsn_code: it.hsn_code || null,
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

    // Stock handling: OUT on sale, IN (restock) on credit notes. Services are skipped.
    if (it.product_id) {
      const [p] = await conn.query('SELECT is_service FROM products WHERE id=?', [it.product_id]);
      if (p.length && !p[0].is_service) {
        const [stk] = await conn.query(
          `SELECT IFNULL(SUM(CASE WHEN type='IN' THEN quantity WHEN type='OUT' THEN -quantity ELSE quantity END),0) AS stock
           FROM stock_movements WHERE product_id=?`,
          [it.product_id]
        );
        if (Number(stk[0].stock) < qty) {
          throw Object.assign(new Error(`Insufficient stock for "${it.item_name}". Only ${stk[0].stock} available.`), { status: 400 });
        }
        await conn.query(
          `INSERT INTO stock_movements (product_id,type,quantity,note,created_by)
           VALUES (?,'OUT',?,?,?)`,
          [it.product_id, qty, `Invoice ${invoiceNumber}`, user.id]
        );
      } else if (isCreditDoc) {
        await conn.query(
          `INSERT INTO stock_movements (product_id,type,quantity,note,created_by)
           VALUES (?,'IN',?,?,?)`,
          [it.product_id, qty, `Credit note ${invoiceNumber} restock`, user.id]
        );
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

  // TCS u/s 206C(1H) on the FY-cumulative sales value above the threshold
  const tcsAmount = await computeTcs(
    conn, customer.id, invDate,
    round2(subtotal - discountTotal), 0, company
  );

  const [ins] = await conn.query(
    `INSERT INTO invoices
     (invoice_number,invoice_date,due_date,customer_id,customer_name,customer_gstin,invoice_type,
      place_of_supply,is_interstate,status,subtotal,discount,cgst_total,sgst_total,utgst_total,igst_total,cess_total,
      tax_total,round_off,grand_total,paid_amount,balance_due,payment_mode,tcs_amount,notes,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      invoiceNumber,
      invDate,
      b.due_date || null,
      customer.id,
      customer.name,
      customer.gstin || null,
      invoiceType,
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

  // Paid amount (if payment_mode != CREDIT and amount given)
  let paidAmount = 0;
  let paymentId = null;
  const payAmount = Number(b.paid_amount) || 0;
  if (payAmount > 0) {
    paidAmount = Math.min(payAmount, grandTotal);
    const [payIns] = await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [invoiceId, customer.id, b.invoice_date || new Date().toISOString().slice(0, 10), paidAmount,
       b.payment_mode === 'CREDIT' ? 'OTHER' : b.payment_mode, b.reference_no || null, 'Payment on invoice', user.id]
    );
    paymentId = payIns.insertId;
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
  }, user.id);
  if (paymentId) {
    await ledger.postSalePayment(conn, {
      invoice: { invoice_number: invoiceNumber },
      amount: paidAmount,
      date: b.invoice_date || localDateStr(),
      mode: b.payment_mode === 'CREDIT' ? 'OTHER' : b.payment_mode || 'CASH',
      payment_id: paymentId,
      created_by: user.id,
    });
  }

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
    const { amount, mode, reference_no, date, note } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Valid amount required.' });

    await conn.beginTransaction();
    const [inv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
    if (!inv.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
    const invoice = inv[0];
    if (invoice.status === 'CANCELLED') throw Object.assign(new Error('Cannot pay a cancelled invoice.'), { status: 400 });

    let pending = Number(invoice.balance_due);
    const pay = Math.min(Number(amount), pending);
    pending = round2(pending - pay);

    const [payIns] = await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [invoice.id, invoice.customer_id, date || localDateStr(), pay,
       mode || 'CASH', reference_no || null, note || null, req.user.id]
    );
    const paymentId = payIns.insertId;
    const newPaid = round2(Number(invoice.paid_amount) + pay);
    const status = pending === 0 ? 'PAID' : 'PARTIAL';
    await conn.query(
      'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [newPaid, pending, status, invoice.id]
    );
    await ledger.postSalePayment(conn, {
      invoice: { invoice_number: invoice.invoice_number },
      amount: pay,
      date: date || localDateStr(),
      mode: mode || 'CASH',
      payment_id: paymentId,
      created_by: req.user.id,
    });
    await refreshCustomerBalance(conn, invoice.customer_id);
    await conn.commit();
    await audit(req, 'PAY', 'payment', invoiceId, { amount: pay, mode: mode || 'CASH', invoice_number: invoice.invoice_number });
    res.json({ message: 'Payment recorded.', balance_due: pending });
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

    // Restore stock
    const [items] = await conn.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id=?', [invoiceId]);
    for (const it of items) {
      if (it.product_id) {
        await conn.query(
          `INSERT INTO stock_movements (product_id,type,quantity,note,created_by)
           VALUES (?,'IN',?,'Cancelled invoice restore',?)`,
          [it.product_id, it.quantity, req.user.id]
        );
      }
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