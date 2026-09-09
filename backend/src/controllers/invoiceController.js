const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { buildInvoiceNumber } = require('../utils/helpers');

/**
 * Create a GST invoice with full tax computation.
 * body: {
 *   customer_id, invoice_date, due_date,
 *   place_of_supply (2-digit) optional (defaults to customer.state_code or company state),
 *   payment_mode, notes,
 *   items: [{ product_id?, item_name, hsn_code, quantity, unit, unit_price, discount, gst_rate }]
 * }
 */
async function create(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_id is required.' });
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required.' });
    }

    await conn.beginTransaction();

    // Fetch company settings (state code, invoice numbering)
    const [cRows] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = cRows[0] || {};
    const companyState = company.state_code || '29';

    // Atomically allocate next invoice number (gap-less, GST-compliant)
    await conn.query(
      'UPDATE company_settings SET invoice_start_number = invoice_start_number + 1 ORDER BY id LIMIT 1'
    );
    const seq = Number(company.invoice_start_number || 0) + 1;
    const invoiceNumber = buildInvoiceNumber(company.invoice_prefix || 'INV', seq);

    // Fetch customer
    const [custRows] = await conn.query('SELECT * FROM customers WHERE id=?', [b.customer_id]);
    if (!custRows.length) throw Object.assign(new Error('Customer not found.'), { status: 404 });
    const customer = custRows[0];

    const placeOfSupply = b.place_of_supply || customer.state_code || companyState;
    const isInterstate = String(placeOfSupply) !== String(companyState);

    let subtotal = 0, discountTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0, cessTotal = 0, taxTotal = 0, grandTotal = 0;
    const itemRows = [];

    for (const it of b.items) {
      const qty = Number(it.quantity) || 1;
      const rate = Number(it.unit_price) || 0;
      const disc = Number(it.discount) || 0;
      const gstRate = Number(it.gst_rate) || 0;
      const gross = qty * rate;
      const taxableValue = gross - disc;
      const tax = splitGst(taxableValue, gstRate, placeOfSupply, companyState);

      subtotal += gross;
      discountTotal += disc;
      cgstTotal += tax.cgst;
      sgstTotal += tax.sgst;
      igstTotal += tax.igst;
      cessTotal += tax.cess;
      taxTotal += tax.cgst + tax.sgst + tax.igst + tax.cess;
      grandTotal += taxableValue + tax.cgst + tax.sgst + tax.igst + tax.cess;

      itemRows.push({
        product_id: it.product_id || null,
        item_name: it.item_name,
        hsn_code: it.hsn_code || null,
        gst_rate: gstRate,
        quantity: qty,
        unit: it.unit || 'PCS',
        unit_price: rate,
        discount: disc,
        taxable_value: round2(taxableValue),
        cgst_amount: tax.cgst,
        sgst_amount: tax.sgst,
        igst_amount: tax.igst,
        cess_amount: tax.cess,
        total: round2(taxableValue + tax.cgst + tax.sgst + tax.igst + tax.cess),
      });

      // Stock OUT for products
      if (it.product_id) {
        const [p] = await conn.query('SELECT is_service FROM products WHERE id=?', [it.product_id]);
        if (p.length && !p[0].is_service) {
          // Check availability
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
            [it.product_id, qty, `Invoice ${invoiceNumber}`, req.user.id]
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

    const invoiceType = customer.gstin ? 'B2B' : 'B2C';
    const [ins] = await conn.query(
      `INSERT INTO invoices
       (invoice_number,invoice_date,due_date,customer_id,customer_name,customer_gstin,invoice_type,
        place_of_supply,is_interstate,status,subtotal,discount,cgst_total,sgst_total,igst_total,cess_total,
        tax_total,round_off,grand_total,paid_amount,balance_due,payment_mode,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        invoiceNumber,
        b.invoice_date || new Date().toISOString().slice(0, 10),
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
        round2(igstTotal),
        round2(cessTotal),
        round2(taxTotal),
        roundOff,
        grandTotal,
        0,
        grandTotal,
        b.payment_mode || 'CREDIT',
        b.notes || null,
        req.user.id,
      ]
    );
    const invoiceId = ins.insertId;

    for (const it of itemRows) {
      await conn.query(
        `INSERT INTO invoice_items
         (invoice_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          invoiceId, it.product_id, it.item_name, it.hsn_code, it.gst_rate, it.quantity, it.unit,
          it.unit_price, it.discount, it.taxable_value, it.cgst_amount, it.sgst_amount,
          it.igst_amount, it.cess_amount, it.total,
        ]
      );
    }

    // Paid amount (if payment_mode != CREDIT and amount given)
    let paidAmount = 0;
    const payAmount = Number(b.paid_amount) || 0;
    if (payAmount > 0) {
      paidAmount = Math.min(payAmount, grandTotal);
      await conn.query(
        `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [invoiceId, customer.id, b.invoice_date || new Date().toISOString().slice(0, 10), paidAmount,
         b.payment_mode === 'CREDIT' ? 'OTHER' : b.payment_mode, b.reference_no || null, 'Payment on invoice', req.user.id]
      );
    }
    const status = paidAmount >= grandTotal ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
    const balance = round2(grandTotal - paidAmount);
    await conn.query(
      'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [paidAmount, balance, status, invoiceId]
    );

    await conn.commit();

    // Refresh debtor balance: recompute from unpaid invoices for the party
    await refreshCustomerBalance(conn, customer.id);

    res.status(201).json({
      id: invoiceId,
      invoice_number: invoiceNumber,
      grand_total: grandTotal,
      message: 'Invoice created.',
    });
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
    const [rows] = await pool.query('SELECT * FROM invoices WHERE id=?', [Number(req.params.id)]);
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

    await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [invoice.id, invoice.customer_id, date || new Date().toISOString().slice(0, 10), pay,
       mode || 'CASH', reference_no || null, note || null, req.user.id]
    );
    const newPaid = round2(Number(invoice.paid_amount) + pay);
    const status = pending === 0 ? 'PAID' : 'PARTIAL';
    await conn.query(
      'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [newPaid, pending, status, invoice.id]
    );
    await refreshCustomerBalance(conn, invoice.customer_id);
    await conn.commit();
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
    await conn.beginTransaction();
    const [inv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
    if (!inv.length) throw Object.assign(new Error('Invoice not found.'), { status: 404 });
    if (inv[0].status === 'CANCELLED') return res.status(400).json({ error: 'Already cancelled.' });

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
    await conn.query("UPDATE invoices SET status='CANCELLED', balance_due=0 WHERE id=?", [invoiceId]);
    await refreshCustomerBalance(conn, inv[0].customer_id);
    await conn.commit();
    res.json({ message: 'Invoice cancelled and stock restored.' });
  } catch (e) {
    await conn.rollback();
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

module.exports = { create, list, get, addPayment, cancel };