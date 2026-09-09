const { getPool } = require('../db');
const { splitGst, round2 } = require('../utils/gst');
const { buildInvoiceNumber } = require('../utils/helpers');
const { createInvoiceCore } = require('./invoiceController');

const FREQ_DELTA = { MONTHLY: 1, HALF_YEARLY: 6, QUARTERLY: 3, YEARLY: 12 };

function localDate(d) {
  const x = d ? new Date(d) : new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function nextDue(frequency, fromDate, dayOfMonth) {
  const d = fromDate ? new Date(fromDate) : new Date();
  d.setDate(1);
  const months = FREQ_DELTA[frequency] || 1;
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(Number(dayOfMonth) || 1, lastDay));
  return d.toISOString().slice(0, 10);
}

async function refreshCustomerBalance(conn, customerId) {
  const [rows] = await conn.query(
    `SELECT IFNULL(SUM(balance_due),0) AS due FROM invoices
     WHERE customer_id=? AND status NOT IN ('CANCELLED','PAID')`,
    [customerId]
  );
  if (rows.length) {
    await conn.query('UPDATE customers SET outstanding_balance=? WHERE id=?', [round2(rows[0].due), customerId]);
  }
}

async function list(_req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT r.*, c.state_code, c.gstin AS customer_contact_gstin
       FROM recurring_invoices r
       LEFT JOIN customers c ON c.id=r.customer_id
       ORDER BY r.is_active DESC, r.next_run_date ASC, r.id DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.customer_id) return res.status(400).json({ error: 'customer_id is required.' });
    if (!b.title) return res.status(400).json({ error: 'Item / service title is required.' });
    const pool = getPool();
    const [[cust]] = await pool.query('SELECT id, name, gstin FROM customers WHERE id=?', [b.customer_id]);
    if (!cust) return res.status(404).json({ error: 'Customer not found.' });
    const [r] = await pool.query(
      `INSERT INTO recurring_invoices
       (customer_id,customer_name,customer_gstin,title,hsn_code,gst_rate,unit,quantity,unit_price,
        frequency,next_run_date,payment_mode,is_active,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cust.id, cust.name, cust.gstin || null, b.title, b.hsn_code || null, Number(b.gst_rate) || 0,
        b.unit || 'PCS', Number(b.quantity) || 1, Number(b.unit_price) || 0,
        b.frequency || 'MONTHLY', b.next_run_date || localDate(),
        b.payment_mode || 'CREDIT', b.is_active === undefined ? 1 : b.is_active ? 1 : 0,
        b.notes || null, req.user.id,
      ]
    );
    res.status(201).json({ id: r.insertId, message: 'Recurring invoice created.' });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const allowed = ['title', 'hsn_code', 'gst_rate', 'unit', 'quantity', 'unit_price', 'frequency', 'next_run_date', 'payment_mode', 'is_active', 'notes', 'customer_id'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (b[f] !== undefined) { sets.push(`${f}=?`); params.push(b[f]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(id);
    const [r] = await getPool().query(`UPDATE recurring_invoices SET ${sets.join(', ')} WHERE id=?`, params);
    if (!r.affectedRows) return res.status(404).json({ error: 'Recurring invoice not found.' });
    res.json({ message: 'Recurring invoice updated.' });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const [r] = await getPool().query('DELETE FROM recurring_invoices WHERE id=?', [Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Recurring invoice not found.' });
    res.json({ message: 'Recurring invoice deleted.' });
  } catch (e) {
    next(e);
  }
}

/**
 * Generate invoices for all due templates (next_run_date <= today).
 * Runs inside per-template transactions so one failure stops only that template.
 * userId is used when the template has no recorded creator (scheduler runs).
 */
async function runDue(userId) {
  const pool = getPool();
  const todayIso = localDate();
  const [due] = await pool.query(
    'SELECT * FROM recurring_invoices WHERE is_active = 1 AND next_run_date <= ? ORDER BY next_run_date ASC',
    [todayIso]
  );
  const created = [];
  const errors = [];
  for (const t of due) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const payload = {
        customer_id: t.customer_id,
        invoice_date: todayIso,
        due_date: nextDue(t.frequency, todayIso, 1),
        payment_mode: t.payment_mode || 'CREDIT',
        notes: `Recurring: ${t.title} (${t.frequency})`,
        items: [{
          product_id: null,
          item_name: t.title,
          hsn_code: t.hsn_code || null,
          gst_rate: Number(t.gst_rate) || 0,
          quantity: Number(t.quantity) || 1,
          unit: t.unit || 'PCS',
          unit_price: Number(t.unit_price) || 0,
          discount: 0,
        }],
      };
      const result = await createInvoiceCore(conn, { id: t.created_by || userId || 1 }, payload);
      await conn.commit();
      await refreshCustomerBalance(conn, t.customer_id);
      const day = t.next_run_date ? new Date(t.next_run_date).getDate() : 1;
      await pool.query(
        'UPDATE recurring_invoices SET last_run_date=?, next_run_date=? WHERE id=?',
        [todayIso, nextDue(t.frequency, todayIso, day), t.id]
      );
      created.push({ id: t.id, invoice_number: result.resp.invoice_number, amount: result.resp.grand_total });
    } catch (e) {
      await conn.rollback().catch(() => {});
      errors.push({ id: t.id, reason: e.message });
    } finally {
      conn.release();
    }
  }
  return { created, errors };
}

/**
 * POST /api/recurring/generate
 */
async function generate(req, res, next) {
  try {
    const result = await runDue(req.user.id);
    res.json({ ...result, message: `${result.created.length} recurring invoice(s) generated.` });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, update, remove, generate, runDue, nextDue };