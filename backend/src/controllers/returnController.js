const { getPool } = require('../db');
const { round2 } = require('../utils/gst');
const { localDateStr } = require('../utils/helpers');
const { getActiveBranch } = require('../utils/branch');
const { allocateInvoiceNumber, allocateReturnNumber } = require('../utils/invoiceNumber');
const { audit } = require('../utils/audit');
const ledger = require('../utils/ledger');
const lots = require('../utils/lots');
const payments = require('../utils/payments');

const RETURNABLE_DOCS = ['B2B', 'B2C', 'EXPORT', 'NIL'];

/**
 * Sales return / refund / exchange against an original invoice.
 *
 * body: {
 *   invoice_id            original invoice id (required)
 *   items: [{ invoice_item_id, quantity }]   returned lines + quantities (required)
 *   reason, date, type ('RETURN'|'EXCHANGE'), refund_mode ('REFUND'|'CREDIT'),
 *   exchange_invoice_id   optional linked replacement sale for exchanges
 * }
 *
 * Creates:
 *   - a CREDIT_NOTE invoice (negative signed) linked to the original (GSTR-1 CDNR)
 *   - a `returns` + `return_items` record tracking the workflow + refund status
 *   - automatic stock restock of the returned quantities (exact lots)
 *   - automatic accounting: mirrors the sale ledger via the signed credit note;
 *     a cash/bank refund voucher per refund leg (Dr customer / Cr cash-bank)
 *   - refund to the ORIGINAL payment modes when refund_mode='REFUND' (proportional
 *     to how the invoice was settled); otherwise the value becomes customer credit
 */
async function createReturn(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    const invoiceId = Number(b.invoice_id);
    if (!invoiceId) throw Object.assign(new Error('invoice_id is required.'), { status: 400, expose: true });
    if (!Array.isArray(b.items) || b.items.length === 0) {
      throw Object.assign(new Error('At least one returned item is required.'), { status: 400, expose: true });
    }

    await conn.beginTransaction();

    const branch = await getActiveBranch(conn);
    const [cRows] = await conn.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    const company = cRows[0] || {};

    // Original invoice must exist, be a sale, and not already cancelled/returned.
    const [invRows] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [invoiceId]);
    if (!invRows.length) throw Object.assign(new Error('Original invoice not found.'), { status: 404, expose: true });
    const original = invRows[0];
    if (!RETURNABLE_DOCS.includes(original.invoice_type)) {
      throw Object.assign(new Error('This document cannot be returned.'), { status: 400, expose: true });
    }
    if (original.status === 'CANCELLED') {
      throw Object.assign(new Error('Cannot return a cancelled invoice.'), { status: 400, expose: true });
    }
    if (original.status === 'RETURNED') {
      throw Object.assign(new Error('Invoice is already fully returned.'), { status: 400, expose: true });
    }

    const [itemRows] = await conn.query('SELECT * FROM invoice_items WHERE invoice_id=?', [invoiceId]);
    const byId = new Map(itemRows.map((it) => [Number(it.id), it]));

    // Validate each returned line + compute proportional tax from the ORIGINAL
    // line (audit-clean: the credit note reverses exactly what was billed).
    const returnLines = [];
    let subtotal = 0, discount = 0, cgst = 0, sgst = 0, utgst = 0, igst = 0, cess = 0, grand = 0;
    let fullyReturned = itemRows.length > 0;
    for (const reqLine of b.items) {
      const iiId = Number(reqLine.invoice_item_id);
      const qty = Number(reqLine.quantity) || 0;
      const line = byId.get(iiId);
      if (!line) throw Object.assign(new Error(`Invoice line ${iiId} not found on this invoice.`), { status: 400, expose: true });
      if (qty <= 0) throw Object.assign(new Error('Return quantity must be greater than zero.'), { status: 400, expose: true });

      const soldQty = Number(line.quantity);
      const alreadyReturned = Number(line.returned_qty) || 0;
      const remaining = round2(soldQty - alreadyReturned);
      if (qty > remaining + 0.0001) {
        throw Object.assign(
          new Error(`Cannot return ${qty} x "${line.item_name}". Only ${remaining} of the sold ${soldQty} is still returnable.`),
          { status: 400, expose: true }
        );
      }

      const ratio = round2(qty / soldQty);
      const gross = round2(Number(line.unit_price) * qty);
      const lineDisc = round2((Number(line.discount) || 0) * ratio);
      const taxable = round2((Number(line.taxable_value) || 0) * ratio);
      const lCgst = round2((Number(line.cgst_amount) || 0) * ratio);
      const lSgst = round2((Number(line.sgst_amount) || 0) * ratio);
      const lUtgst = round2((Number(line.utgst_amount) || 0) * ratio);
      const lIgst = round2((Number(line.igst_amount) || 0) * ratio);
      const lCess = round2((Number(line.cess_amount) || 0) * ratio);
      const lineTotal = round2((Number(line.total) || 0) * ratio);

      subtotal += gross;
      discount += lineDisc;
      cgst += lCgst;
      sgst += lSgst;
      utgst += lUtgst;
      igst += lIgst;
      cess += lCess;
      grand += lineTotal;

      returnLines.push({
        invoice_item_id: iiId,
        product_id: line.product_id,
        item_name: line.item_name,
        hsn_code: line.hsn_code,
        gst_rate: line.gst_rate,
        quantity: qty,
        unit: line.unit || 'PCS',
        unit_price: line.unit_price,
        discount: lineDisc,
        taxable_value: taxable,
        cgst_amount: lCgst,
        sgst_amount: lSgst,
        utgst_amount: lUtgst,
        igst_amount: lIgst,
        cess_amount: lCess,
        total: lineTotal,
      });
      if (round2(alreadyReturned + qty) < soldQty) fullyReturned = false;
    }

    subtotal = round2(subtotal);
    discount = round2(discount);
    cgst = round2(cgst); sgst = round2(sgst); utgst = round2(utgst); igst = round2(igst); cess = round2(cess);
    grand = round2(grand);

    // Round-off on the credit note just like the sale (kept for the returns record).
    let roundOff = 0;
    if (Number(company.round_off) === 1) {
      const rounded = Math.round(grand);
      roundOff = round2(rounded - grand);
      grand = rounded;
    }

    const refundMode = String(b.refund_mode || 'REFUND').toUpperCase();
    const retType = String(b.type || 'RETURN').toUpperCase() === 'EXCHANGE' ? 'EXCHANGE' : 'RETURN';

    // Refund to original payment modes (proportional to how it was settled).
    // Refunds can never exceed what was actually paid; the remainder becomes credit.
    let refundLegs = [];
    let refundAmount = 0;
    if (refundMode === 'REFUND') {
      const [paidRows] = await conn.query(
        `SELECT mode, SUM(amount) AS amt FROM payments
         WHERE invoice_id=? AND payment_type='PAYMENT' GROUP BY mode`,
        [invoiceId]
      );
      const originalPaid = round2(paidRows.reduce((s, r) => s + Number(r.amt), 0));
      if (originalPaid > 0 && grand > 0) {
        refundAmount = Math.min(grand, originalPaid);
        let remainingRefund = refundAmount;
        const modes = paidRows.filter((r) => Number(r.amt) > 0);
        // Distribute proportionally; keep the final rounding on the last leg.
        for (let i = 0; i < modes.length; i++) {
          const isLast = i === modes.length - 1;
          let part = isLast
            ? round2(remainingRefund)
            : round2((Number(modes[i].amt) / originalPaid) * refundAmount);
          part = Math.min(part, remainingRefund);
          if (part > 0) refundLegs.push({ mode: payments.normalizeMode(modes[i].mode), amount: round2(part), reference_no: null });
          remainingRefund = round2(remainingRefund - part);
        }
      }
    }
    refundAmount = round2(refundLegs.reduce((s, l) => s + l.amount, 0));

    // Exchange: optionally link a replacement sale invoice (same customer).
    let exchangeInvoice = null;
    if (retType === 'EXCHANGE' && b.exchange_invoice_id) {
      const [x] = await conn.query('SELECT id, invoice_number, customer_id FROM invoices WHERE id=?', [Number(b.exchange_invoice_id)]);
      if (!x.length) throw Object.assign(new Error('Exchange invoice not found.'), { status: 400, expose: true });
      if (Number(x[0].customer_id) !== Number(original.customer_id)) {
        throw Object.assign(new Error('Exchange invoice belongs to a different customer.'), { status: 400, expose: true });
      }
      exchangeInvoice = x[0];
    }

    const returnDate = b.date && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? b.date : localDateStr();
    const returnNumber = await allocateReturnNumber(conn, branch, returnDate);
    const cnNumber = await allocateInvoiceNumber(conn, branch, returnDate);

    // 1. Returns header (positive money-value record for the workflow).
    const [retIns] = await conn.query(
      `INSERT INTO returns
       (return_number,return_date,invoice_id,invoice_number,customer_id,customer_name,reason,type,
        subtotal,discount,cgst_total,sgst_total,utgst_total,igst_total,cess_total,tax_total,round_off,grand_total,
        refunded_amount,refund_status,credit_note_id,credit_note_number,exchange_invoice_id,exchange_invoice_number,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        returnNumber, returnDate, invoiceId, original.invoice_number, original.customer_id, original.customer_name,
        (b.reason || '').toString().trim().slice(0, 255) || null, retType,
        subtotal, discount, cgst, sgst, utgst, igst, cess,
        round2(cgst + sgst + utgst + igst + cess), roundOff, grand,
        0, 'PENDING', null, null,
        exchangeInvoice ? exchangeInvoice.id : null, exchangeInvoice ? exchangeInvoice.invoice_number : null,
        req.user.id,
      ]
    );
    const returnId = retIns.insertId;

    // 2. Return line items.
    for (const l of returnLines) {
      await conn.query(
        `INSERT INTO return_items
         (return_id,invoice_item_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,utgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          returnId, l.invoice_item_id, l.product_id, l.item_name, l.hsn_code, l.gst_rate, l.quantity, l.unit, l.unit_price,
          l.discount, l.taxable_value, l.cgst_amount, l.sgst_amount, l.utgst_amount, l.igst_amount, l.cess_amount, l.total,
        ]
      );
    }

    // 3. Credit note invoice (negative signed values, linked for CDNR).
    const neg = (v) => round2(-Number(v));
    // paid_amount is stored negative for credit notes so the universal formula
    // balance_due = grand_total - paid_amount yields the correct remaining credit:
    //   -1770 - (-945) = -825  (customer is owed ₹825 after partial refund)
    const cnPaidAmount = refundLegs.length ? round2(-refundAmount) : 0;
    const cnBalance = round2(neg(grand) - cnPaidAmount);
    const cnStatus = Math.abs(cnBalance) < 0.01 ? 'PAID' : 'PENDING';
    const [cnIns] = await conn.query(
      `INSERT INTO invoices
       (invoice_number,invoice_date,customer_id,customer_name,customer_gstin,invoice_type,
        original_invoice_id,against_invoice_no,place_of_supply,is_interstate,status,subtotal,discount,cgst_total,sgst_total,utgst_total,igst_total,cess_total,
        tax_total,round_off,grand_total,paid_amount,balance_due,payment_mode,tcs_amount,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cnNumber, returnDate, original.customer_id, original.customer_name, original.customer_gstin,
        'CREDIT_NOTE',
        original.id, original.invoice_number,
        original.place_of_supply, original.is_interstate,
        cnStatus,
        neg(subtotal), neg(discount), neg(cgst), neg(sgst), neg(utgst), neg(igst), neg(cess),
        neg(round2(cgst + sgst + utgst + igst + cess)), roundOff, neg(grand),
        cnPaidAmount, cnBalance,
        refundLegs.length ? refundLegs[0].mode : 'OTHER',
        0,
        `Return ${returnNumber}${b.reason ? ' - ' + b.reason : ''}`,
        req.user.id,
      ]
    );
    const cnId = cnIns.insertId;

    // 4. Credit note line items.
    for (const l of returnLines) {
      await conn.query(
        `INSERT INTO invoice_items
         (invoice_id,product_id,item_name,hsn_code,gst_rate,quantity,unit,unit_price,discount,
          taxable_value,cgst_amount,sgst_amount,utgst_amount,igst_amount,cess_amount,total)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          cnId, l.product_id, l.item_name, l.hsn_code, l.gst_rate, l.quantity, l.unit, l.unit_price,
          neg(l.discount), neg(l.taxable_value), neg(l.cgst_amount), neg(l.sgst_amount), neg(l.utgst_amount), neg(l.igst_amount), neg(l.cess_amount), neg(l.total),
        ]
      );
    }

    // 5. Automatic stock reversal (returned goods back to their exact lots).
    const stockLines = returnLines
      .filter((l) => l.product_id)
      .map((l) => ({ product_id: l.product_id, qty: l.quantity }));
    const restored = stockLines.length
      ? await lots.restoreForReturn(conn, {
          invoice_id: invoiceId,
          lines: stockLines,
          reference_type: 'return',
          reference_id: returnId,
          created_by: req.user.id,
          note: `Return ${returnNumber} restock`,
        })
      : 0;

    // 6. Accounting: signed credit note mirrors the sale ledger.
    await ledger.postSale(conn, {
      id: cnId,
      invoice_number: cnNumber,
      invoice_date: returnDate,
      customer_name: original.customer_name,
      grand_total: neg(grand),
      subtotal: neg(subtotal),
      cgst_total: neg(cgst),
      sgst_total: neg(sgst),
      utgst_total: neg(utgst),
      igst_total: neg(igst),
      cess_total: neg(cess),
    }, req.user.id);

    // 7. Refund to original payment modes + ledger vouchers.
    let refundStatus = 'CREDITED';
    if (refundLegs.length) {
      await payments.recordRefundPayments(conn, {
        invoice: { id: cnId, invoice_number: cnNumber, customer_id: original.customer_id },
        customer_id: original.customer_id,
        legs: refundLegs,
        date: returnDate,
        created_by: req.user.id,
      });
      refundStatus = Math.abs(cnBalance) < 0.01 ? 'REFUNDED' : 'PARTIAL';
    }
    await conn.query(
      'UPDATE returns SET refunded_amount=?, refund_status=?, credit_note_id=?, credit_note_number=? WHERE id=?',
      [refundAmount, refundStatus, cnId, cnNumber, returnId]
    );

    // 8. Track returned quantities on the original lines; mark fully-returned.
    for (const l of returnLines) {
      await conn.query(
        'UPDATE invoice_items SET returned_qty=ROUND(returned_qty + ?, 2) WHERE id=?',
        [l.quantity, l.invoice_item_id]
      );
    }
    if (fullyReturned) {
      await conn.query("UPDATE invoices SET status='RETURNED', balance_due=0 WHERE id=?", [invoiceId]);
    }

    // 9. Recompute the customer's receivable (credit notes reduce the balance).
    await refreshCustomerBalance(conn, original.customer_id);
    await conn.commit();

    await audit(req, 'CREATE', 'return', returnId, {
      return_number: returnNumber,
      invoice_number: original.invoice_number,
      customer_id: original.customer_id,
      grand_total: grand,
      refunded: refundAmount,
      type: retType,
    });
    await audit(req, 'CREATE', 'invoice', cnId, {
      invoice_number: cnNumber,
      type: 'CREDIT_NOTE',
      original_invoice: original.invoice_number,
      amount: neg(grand),
    });

    res.status(201).json({
      return_id: returnId,
      return_number: returnNumber,
      credit_note_id: cnId,
      credit_note_number: cnNumber,
      grand_total: grand,
      refunded_amount: refundAmount,
      refund_status: refundStatus,
      stock_movements: restored,
      message: `Return ${returnNumber} recorded${refundAmount > 0 ? `; ${payments.normalizeMode(refundLegs[0].mode)} refund ${grand === refundAmount ? 'in full' : ''}` : '; value credited to the customer.'}`,
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
 * List returns with optional filters.
 */
async function list(req, res, next) {
  try {
    const { q, from, to, customer_id, page = 1, limit = 20 } = req.query;
    const where = [];
    const params = [];
    if (q) where.push('(r.return_number LIKE ? OR r.invoice_number LIKE ? OR r.customer_name LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    if (from) where.push('r.return_date >= ?'), params.push(from);
    if (to) where.push('r.return_date <= ?'), params.push(to);
    if (customer_id) where.push('r.customer_id = ?'), params.push(Number(customer_id));
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);

    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT r.*, c.name AS customer_display
       FROM returns r LEFT JOIN customers c ON c.id=r.customer_id
       ${whereSql} ORDER BY r.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM returns r ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

/**
 * Get one return with its lines + the linked credit note.
 */
async function get(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM returns WHERE id=?', [Number(req.params.id)]);
    if (!rows.length) return res.status(404).json({ error: 'Return not found.' });
    const [items] = await pool.query('SELECT * FROM return_items WHERE return_id=? ORDER BY id', [rows[0].id]);
    const [cn] = rows[0].credit_note_id
      ? await pool.query('SELECT * FROM invoices WHERE id=?', [rows[0].credit_note_id])
      : [null];
    const [original] = await pool.query('SELECT * FROM invoices WHERE id=?', [rows[0].invoice_id]);
    const [company] = await pool.query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    res.json({ ...rows[0], items: items || [], credit_note: cn || null, original_invoice: original[0] || null, company: company[0] || null });
  } catch (e) {
    next(e);
  }
}

/**
 * Recompute a customer's receivable balance from non-cancelled invoices.
 */
async function refreshCustomerBalance(conn, customerId) {
  const [rows] = await conn.query(
    `SELECT IFNULL(SUM(balance_due),0) AS due FROM invoices
     WHERE customer_id=? AND status NOT IN ('CANCELLED','PAID','RETURNED')`,
    [customerId]
  );
  if (rows.length) {
    await conn.query(
      'UPDATE customers SET outstanding_balance=? WHERE id=?',
      [round2(rows[0].due), customerId]
    );
  }
}

module.exports = { createReturn, list, get, refreshCustomerBalance };