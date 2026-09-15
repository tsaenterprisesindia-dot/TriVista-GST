/**
 * payments.js - shared payment-leg parsing and recording for split payments.
 *
 * Every sale/purchase can be settled with one or more payment methods
 * (e.g. cash + UPI). Each leg becomes its own row in `payments` and its own
 * balanced ledger voucher, so receipts by cash go to the cash account while
 * UPI / card / bank legs go to the bank account.
 *
 * Requests may send either:
 *   - `payments: [{ mode, amount, reference_no }]`  (split, preferred)
 *   - legacy single leg: `payment_mode` + `paid_amount` (invoice/purchase
 *     creation) or `mode` + `amount` (record-payment endpoints)
 */
const { round2 } = require('./gst');
const ledger = require('./ledger');

const MODES = ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];

function normalizeMode(m) {
  const s = String(m || '').trim().toUpperCase();
  return MODES.includes(s) ? s : 'OTHER';
}

function paymentError(msg) {
  return Object.assign(new Error(msg), { status: 400, expose: true });
}

/**
 * Convert a request body into a list of payment legs.
 * @returns {{ legs: Array<{mode,amount,reference_no}>, total: number }} — legs is
 *          [] when no payment is being recorded.
 */
function parsePayments(body = {}, opts = {}) {
  const defaultMode = opts.defaultMode || 'CASH';

  if (Array.isArray(body.payments)) {
    if (!body.payments.length) return { legs: [], total: 0 };
    const legs = body.payments.map((p, i) => {
      const amount = round2(Number(p && p.amount !== undefined ? p.amount : 0) || 0);
      if (amount <= 0) throw paymentError(`Payment line ${i + 1}: amount must be greater than zero.`);
      const ref = p && p.reference_no ? String(p.reference_no).trim().slice(0, 60) : null;
      return { mode: normalizeMode(p && p.mode), amount, reference_no: ref };
    });
    return { legs, total: round2(legs.reduce((s, l) => s + l.amount, 0)) };
  }

  // Legacy single leg
  const legacyAmount =
    Number(body.paid_amount) > 0 ? Number(body.paid_amount) : Number(body.amount) || 0;
  if (legacyAmount <= 0) return { legs: [], total: 0 };
  const mode = normalizeMode(body.payment_mode || body.mode || defaultMode);
  return {
    legs: [{ mode, amount: round2(legacyAmount), reference_no: body.reference_no ? String(body.reference_no).trim().slice(0, 60) : null }],
    total: round2(legacyAmount),
  };
}

/**
 * Cap the total of a leg set to `max` (like the historical behaviour of
 * silently capping a single payment to the balance due). Any overshoot is
 * removed from the last leg; legs trimmed to zero are dropped.
 */
function capLegs(legs, max) {
  const total = round2(legs.reduce((s, l) => s + l.amount, 0));
  if (total <= max) return { legs, total };
  let over = round2(total - max);
  const out = legs.map((l) => {
    if (over <= 0) return l;
    const cut = Math.min(l.amount, over);
    over = round2(over - cut);
    return { ...l, amount: round2(l.amount - cut) };
  });
  const kept = out.filter((l) => l.amount > 0);
  return { legs: kept, total: round2(max) };
}

/**
 * Insert split payment rows + one ledger voucher per leg (records a sale payment).
 * Runs inside the caller's transaction. Returns the inserted payment ids.
 */
async function recordInvoicePayments(conn, { invoice, customer_id, legs, date, created_by }) {
  const ids = [];
  const count = legs.length;
  const suffix = count > 1 ? ' (split)' : '';
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const [ins] = await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [
        invoice.id,
        customer_id ?? invoice.customer_id,
        date,
        l.amount,
        l.mode,
        l.reference_no,
        `${count > 1 ? `Payment ${i + 1}/${count}` : 'Payment'} on ${invoice.invoice_number}${suffix}${l.reference_no ? ' (' + l.reference_no + ')' : ''}`,
        created_by,
      ]
    );
    ids.push(ins.insertId);
    await ledger.postSalePayment(conn, {
      invoice: { invoice_number: invoice.invoice_number },
      amount: l.amount,
      date,
      mode: l.mode,
      payment_id: ins.insertId,
      created_by,
    });
  }
  return ids;
}

/**
 * Same as recordInvoicePayments but posts a purchase-side payment voucher.
 */
async function recordPurchasePayments(conn, { bill, legs, date, created_by }) {
  const ids = [];
  const count = legs.length;
  const suffix = count > 1 ? ' (split)' : '';
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const [ins] = await conn.query(
      `INSERT INTO payments (date,amount,mode,reference_no,note,created_by,bill_id)
       VALUES (?,?,?,?,?,?,?)`,
      [
        date,
        l.amount,
        l.mode,
        l.reference_no,
        `${count > 1 ? `Payment ${i + 1}/${count}` : 'Payment'} for ${bill.bill_number}${suffix}`,
        created_by,
        bill.id,
      ]
    );
    ids.push(ins.insertId);
    await ledger.postPurchasePayment(conn, {
      bill: { bill_number: bill.bill_number },
      amount: l.amount,
      date,
      mode: l.mode,
      payment_id: ins.insertId,
      created_by,
    });
  }
  return ids;
}

/**
 * Record refund legs back to a customer: one `payments` row per leg with
 * payment_type='REFUND' + a mirrored ledger voucher (Dr customer / Cr cash-bank).
 * Runs inside the caller's transaction. Returns the inserted payment ids.
 */
async function recordRefundPayments(conn, { invoice, customer_id, legs, date, created_by }) {
  const ids = [];
  const count = legs.length;
  const suffix = count > 1 ? ' (split)' : '';
  for (let i = 0; i < legs.length; i++) {
    const l = legs[i];
    const [ins] = await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,payment_type,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,'REFUND',?,?,?,?)`,
      [
        invoice.id,
        customer_id ?? invoice.customer_id,
        date,
        l.amount,
        l.mode,
        l.reference_no,
        `${count > 1 ? `Refund ${i + 1}/${count}` : 'Refund'} on ${invoice.invoice_number}${suffix}${l.reference_no ? ' (' + l.reference_no + ')' : ''}`,
        created_by,
      ]
    );
    ids.push(ins.insertId);
    await ledger.postRefund(conn, {
      invoice: { invoice_number: invoice.invoice_number },
      amount: l.amount,
      date,
      mode: l.mode,
      payment_id: ins.insertId,
      created_by,
    });
  }
  return ids;
}

module.exports = { MODES, normalizeMode, parsePayments, capLegs, recordInvoicePayments, recordPurchasePayments, recordRefundPayments };