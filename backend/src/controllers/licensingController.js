const { getPool } = require('../db');
const { audit } = require('../utils/audit');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');
const { localDateStr } = require('../utils/helpers');
const { createInvoiceCore, refreshCustomerBalance } = require('./invoiceController');

const PLAN_TYPES = ['TRIAL', 'SUBSCRIPTION', 'ONETIME', 'LIFETIME'];
const LIC_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED'];
const PAY_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'];
const { BUSINESS_MODELS } = require('../config/modelPacks');
const { FEATURE_CATALOG } = require('../config/modelPacks');
const MODEL_BUSINESS_SET = new Set(BUSINESS_MODELS);
const FEATURE_KEYS = new Set(FEATURE_CATALOG.map((f) => f.key));

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayStr() {
  return toDateStr(new Date());
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function derivePaymentStatus(amount, paid) {
  const a = Number(amount) || 0;
  const p = Number(paid) || 0;
  if (p >= a && a > 0) return 'PAID';
  if (p > 0) return 'PARTIAL';
  return 'UNPAID';
}

const PAYMENT_MODES = ['CASH', 'CARD', 'UPI', 'BANK', 'OTHER'];
function normalizeMode(m) {
  const v = String(m || '').trim().toUpperCase();
  return PAYMENT_MODES.includes(v) ? v : 'OTHER';
}

/* ---------------- Plans ---------------- */

async function listPlans(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT p.*, COUNT(cl.id) AS usage_count
       FROM license_plans p
       LEFT JOIN client_licenses cl ON cl.plan_id = p.id
       GROUP BY p.id
       ORDER BY p.id`
    );
    const out = rows.map((r) => {
      let features = r.features;
      if (typeof features === 'string' && features) {
        try { features = JSON.parse(features); } catch (_e) { features = null; }
      }
      return { ...r, features: features || {} };
    });
    res.json(out);
  } catch (e) { next(e); }
}

async function createPlan(req, res, next) {
  try {
    const { name, type, duration_days, price, seats, is_active, business_model, features } = req.body || {};
    const t = String(type || '').toUpperCase();
    if (!PLAN_TYPES.includes(t)) return res.status(400).json({ error: 'Please choose a valid plan type.' });
    const nm = String(name || '').trim();
    if (nm.length < 3 || nm.length > 120) return res.status(400).json({ error: 'Plan name must be between 3 and 120 characters.' });
    const bm = String(business_model || 'general');
    if (!MODEL_BUSINESS_SET.has(bm)) return res.status(400).json({ error: 'Invalid business_model.' });
    let feat = null;
    if (features !== undefined) {
      if (typeof features !== 'object' || Array.isArray(features)) return res.status(400).json({ error: 'features must be an object of feature -> boolean.' });
      feat = {};
      for (const [k, v] of Object.entries(features)) {
        if (FEATURE_KEYS.has(k) && typeof v === 'boolean') feat[k] = v;
      }
    }
    let days = null;
    if (t !== 'LIFETIME') {
      days = Number(duration_days);
      if (!Number.isInteger(days) || days <= 0 || days > 3650) {
        return res.status(400).json({ error: 'Duration must be between 1 and 3650 days.' });
      }
    }
    const priceVal = Math.max(0, Number(price) || 0);
    const seatsVal = Math.max(1, Number(seats) || 1);
    const [r] = await getPool().query(
      `INSERT INTO license_plans (name, type, business_model, features, duration_days, price, seats, is_active)
       VALUES (?,?,?,?,?,?,?,?)`,
      [nm, t, bm, feat ? JSON.stringify(feat) : null, days, priceVal, seatsVal, is_active === undefined ? 1 : is_active ? 1 : 0]
    );
    await audit(req, 'PLAN_CREATE', 'license_plan', r.insertId, { name: nm, type: t, price: priceVal, business_model: bm });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
}

async function updatePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid plan id.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM license_plans WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Plan not found.' });
    const before = rows[0];
    const b = req.body || {};
    const p = { ...before, ...b };
    if (b.type !== undefined) p.type = String(p.type).toUpperCase();
    if (!PLAN_TYPES.includes(p.type)) return res.status(400).json({ error: 'Please choose a valid plan type.' });
    if (b.duration_days !== undefined) {
      if (String(p.type) === 'LIFETIME') p.duration_days = null;
      else {
        p.duration_days = Number(p.duration_days);
        if (!Number.isInteger(p.duration_days) || p.duration_days <= 0 || p.duration_days > 3650) {
          return res.status(400).json({ error: 'Duration must be between 1 and 3650 days.' });
        }
      }
    } else if (String(p.type) === 'LIFETIME') {
      p.duration_days = null;
    }
    if (b.price !== undefined) p.price = Math.max(0, Number(p.price) || 0);
    if (b.seats !== undefined) p.seats = Math.max(1, Number(p.seats) || 1);
    if (b.is_active !== undefined) p.is_active = b.is_active ? 1 : 0;
    if (b.business_model !== undefined && !MODEL_BUSINESS_SET.has(b.business_model)) {
      return res.status(400).json({ error: 'Invalid business_model.' });
    }
    if (b.features !== undefined) {
      if (typeof b.features !== 'object' || Array.isArray(b.features)) return res.status(400).json({ error: 'features must be an object of feature -> boolean.' });
      p.features = {};
      for (const [k, v] of Object.entries(b.features)) {
        if (FEATURE_KEYS.has(k) && typeof v === 'boolean') p.features[k] = v;
      }
    }
    const nm = String(p.name || '').trim();
    if (nm.length < 3 || nm.length > 120) return res.status(400).json({ error: 'Plan name must be between 3 and 120 characters.' });
    await pool.query(
      `UPDATE license_plans SET name=?, type=?, business_model=?, features=?, duration_days=?, price=?, seats=?, is_active=? WHERE id=?`,
      [nm, p.type, p.business_model || 'general', p.features !== undefined ? JSON.stringify(p.features) : null, p.duration_days, p.price, p.seats, p.is_active, id]
    );
    await audit(req, 'PLAN_UPDATE', 'license_plan', id, { name: nm, type: p.type, price: p.price, business_model: p.business_model });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function deletePlan(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid plan id.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM license_plans WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Plan not found.' });
    const [[{ used }]] = await pool.query('SELECT COUNT(*) AS used FROM client_licenses WHERE plan_id=?', [id]);
    if (Number(used) > 0) {
      await pool.query('UPDATE license_plans SET is_active=0 WHERE id=?', [id]);
      await audit(req, 'PLAN_DEACTIVATE', 'license_plan', id, { name: rows[0].name });
      return res.json({ ok: true, deactivated: true });
    }
    await pool.query('DELETE FROM license_plans WHERE id=?', [id]);
    await audit(req, 'PLAN_DELETE', 'license_plan', id, { name: rows[0].name });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

/* ---------------- Stats ---------------- */

async function stats(req, res, next) {
  try {
    const pool = getPool();
    const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM client_licenses');
    const [statusRows] = await pool.query(
      `SELECT status, COUNT(*) AS n FROM client_licenses GROUP BY status`
    );
    const byStatus = {};
    for (const r of statusRows) byStatus[r.status] = Number(r.n);
    const countOf = (s) => byStatus[s] || 0;
    const [[{ invoiced }]] = await pool.query('SELECT COALESCE(SUM(amount),0) AS invoiced FROM client_licenses');
    const [[{ paid }]] = await pool.query('SELECT COALESCE(SUM(paid_amount),0) AS paid FROM client_licenses');
    const [[{ arrears }]] = await pool.query(
      'SELECT COALESCE(SUM(GREATEST(amount - paid_amount,0)),0) AS arrears FROM client_licenses'
    );
    const [[{ expiring }]] = await pool.query(
      `SELECT COUNT(*) AS expiring FROM client_licenses
       WHERE status IN ('TRIAL','ACTIVE') AND expiry_date IS NOT NULL
         AND expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`
    );
    const [[{ renewals }]] = await pool.query('SELECT COUNT(*) AS renewals FROM license_renewals');
    const [[{ renewal_revenue }]] = await pool.query(
      'SELECT COALESCE(SUM(amount),0) AS renewal_revenue FROM license_renewals'
    );
    const [monthlyRows] = await pool.query(
      `SELECT DATE_FORMAT(p.date,'%Y-%m') AS ym, COALESCE(SUM(p.amount),0) AS total
       FROM payments p
       JOIN invoices i ON i.id=p.invoice_id
       JOIN client_licenses l ON l.invoice_id=i.id
       WHERE p.date >= DATE_SUB(DATE_FORMAT(CURDATE(),'%Y-%m-01'), INTERVAL 5 MONTH)
       GROUP BY ym ORDER BY ym`
    );
    const [byPlanRows] = await pool.query(
      `SELECT COALESCE(p.id,0) AS plan_id, COALESCE(p.name,'No plan') AS name,
              COUNT(*) AS n, COALESCE(SUM(l.amount),0) AS gross
       FROM client_licenses l
       LEFT JOIN license_plans p ON p.id=l.plan_id
       GROUP BY p.id ORDER BY n DESC`
    );
    const [upcomingRows] = await pool.query(
      `SELECT l.id, l.client_name, l.contact_person, l.phone, l.email, l.status, l.amount, l.paid_amount,
              l.invoice_id, l.expiry_date, p.name AS plan_name,
              DATEDIFF(l.expiry_date, CURDATE()) AS days_left
       FROM client_licenses l
       LEFT JOIN license_plans p ON p.id=l.plan_id
       WHERE l.status IN ('TRIAL','ACTIVE') AND l.expiry_date IS NOT NULL
         AND l.expiry_date >= CURDATE()
         AND DATEDIFF(l.expiry_date, CURDATE()) <= 30
       ORDER BY l.expiry_date ASC, l.id DESC LIMIT 20`
    );
    res.json({
      total,
      active: countOf('ACTIVE'),
      trials: countOf('TRIAL'),
      past_due: countOf('PAST_DUE'),
      expired: countOf('EXPIRED'),
      cancelled: countOf('CANCELLED'),
      expiring_soon: Number(expiring),
      renewals: Number(renewals),
      renewal_revenue: Number(renewal_revenue),
      invoiced: Number(invoiced),
      paid: Number(paid),
      arrears: Number(arrears),
      monthly: monthlyRows,
      by_plan: byPlanRows,
      upcoming: upcomingRows,
    });
  } catch (e) { next(e); }
}

/* ---------------- Client licenses ---------------- */

async function list(req, res, next) {
  try {
    const { status, plan_id, pay, q, expiring } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (status) { where.push('l.status=?'); params.push(String(status).toUpperCase()); }
    if (plan_id) { where.push('l.plan_id=?'); params.push(Number(plan_id)); }
    if (pay) { where.push('l.payment_status=?'); params.push(String(pay).toUpperCase()); }
    if (expiring === '1') {
      where.push(`l.status IN ('TRIAL','ACTIVE') AND l.expiry_date IS NOT NULL
                  AND l.expiry_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)`);
    }
    if (q) {
      where.push('(l.client_name LIKE ? OR l.contact_person LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.gstin LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows] = await pool.query(
      `SELECT l.*, p.name AS plan_name, p.type AS plan_type,
              inv.invoice_number AS invoice_number, inv.grand_total AS invoice_grand, inv.status AS invoice_status,
              inv.balance_due AS invoice_balance
       FROM client_licenses l
       LEFT JOIN license_plans p ON p.id = l.plan_id
       LEFT JOIN invoices inv ON inv.id = l.invoice_id
       ${whereSql}
       ORDER BY l.updated_at DESC, l.id DESC LIMIT 500`,
      params
    );
    res.json(rows);
  } catch (e) { next(e); }
}

async function get(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT l.*, p.name AS plan_name, p.type AS plan_type,
              inv.invoice_number AS invoice_number, inv.grand_total AS invoice_grand, inv.status AS invoice_status,
              inv.balance_due AS invoice_balance
       FROM client_licenses l
       LEFT JOIN license_plans p ON p.id = l.plan_id
       LEFT JOIN invoices inv ON inv.id = l.invoice_id
       WHERE l.id=?`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    const [renewals] = await pool.query(
      `SELECT r.*, p.name AS plan_name FROM license_renewals r
       LEFT JOIN license_plans p ON p.id = r.plan_id
       WHERE r.license_id=? ORDER BY r.id DESC`,
      [id]
    );
    res.json({ ...rows[0], renewals });
  } catch (e) { next(e); }
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    const clientName = String(b.client_name || '').trim();
    if (clientName.length < 2 || clientName.length > 160) {
      return res.status(400).json({ error: 'Client name must be between 2 and 160 characters.' });
    }
    const status = String(b.status || 'TRIAL').toUpperCase();
    if (!LIC_STATUSES.includes(status)) return res.status(400).json({ error: 'Please choose a valid status.' });
    const start = b.start_date || todayStr();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return res.status(400).json({ error: 'Invalid start date.' });
    let expiry = b.expiry_date ? String(b.expiry_date) : null;
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return res.status(400).json({ error: 'Invalid expiry date.' });
    const planId = b.plan_id ? Number(b.plan_id) : null;
    let amount = Math.max(0, Number(b.amount) || 0);
    let seats = Math.max(1, Number(b.seats) || 1);
    if (planId) {
      const [p] = await getPool().query('SELECT * FROM license_plans WHERE id=?', [planId]);
      if (p.length) {
        if (b.amount === undefined || b.amount === null || b.amount === '') amount = Number(p[0].price) || 0;
        if (b.seats === undefined || b.seats === null || b.seats === '') seats = Number(p[0].seats) || 1;
        if (!expiry && p[0].duration_days) expiry = addDays(start, Number(p[0].duration_days));
      }
    }
    const paid = Math.max(0, Number(b.paid_amount) || 0);
    const [r] = await getPool().query(
      `INSERT INTO client_licenses
        (plan_id, client_name, contact_person, phone, email, gstin, start_date, expiry_date,
         status, seats, amount, paid_amount, payment_status, payment_method, notes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        planId, clientName, String(b.contact_person || '') || null, String(b.phone || '') || null,
        String(b.email || '') || null, String(b.gstin || '').toUpperCase() || null,
        start, expiry, status, seats, amount, paid,
        b.payment_status ? String(b.payment_status).toUpperCase() : derivePaymentStatus(amount, paid),
        String(b.payment_method || '') || null, String(b.notes || '') || null,
      ]
    );
    await audit(req, 'LICENSE_CREATE', 'client_license', r.insertId, { client: clientName, plan_id: planId, amount });
    res.status(201).json({ id: r.insertId });
  } catch (e) { next(e); }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM client_licenses WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    const before = rows[0];
    const b = req.body || {};
    const v = { ...before };
    if (b.client_name !== undefined) {
      const nm = String(b.client_name).trim();
      if (nm.length < 2 || nm.length > 160) return res.status(400).json({ error: 'Invalid client name.' });
      v.client_name = nm;
    }
    for (const k of ['contact_person', 'phone', 'email', 'payment_method', 'notes']) {
      if (b[k] !== undefined) v[k] = b[k] === '' ? null : String(b[k]) || null;
    }
    if (b.gstin !== undefined) v.gstin = b.gstin === '' ? null : String(b.gstin).toUpperCase() || null;
    if (b.status !== undefined) {
      const s = String(b.status).toUpperCase();
      if (!LIC_STATUSES.includes(s)) return res.status(400).json({ error: 'Please choose a valid status.' });
      v.status = s;
    }
    if (b.start_date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.start_date)) return res.status(400).json({ error: 'Invalid start date.' });
      v.start_date = b.start_date;
    }
    if (b.expiry_date !== undefined) {
      v.expiry_date = b.expiry_date === '' || b.expiry_date === null ? null : String(b.expiry_date);
      if (v.expiry_date && !/^\d{4}-\d{2}-\d{2}$/.test(v.expiry_date)) return res.status(400).json({ error: 'Invalid expiry date.' });
    }
    if (b.plan_id !== undefined) v.plan_id = b.plan_id === '' ? null : Number(b.plan_id);
    if (b.seats !== undefined) v.seats = Math.max(1, Number(b.seats) || 1);
    if (b.amount !== undefined) v.amount = Math.max(0, Number(b.amount) || 0);
    if (b.paid_amount !== undefined) v.paid_amount = Math.max(0, Number(b.paid_amount) || 0);
    if (b.payment_status !== undefined) v.payment_status = String(b.payment_status).toUpperCase();
    if (!PAY_STATUSES.includes(v.payment_status)) v.payment_status = derivePaymentStatus(v.amount, v.paid_amount);
    await pool.query(
      `UPDATE client_licenses SET plan_id=?, client_name=?, contact_person=?, phone=?, email=?, gstin=?,
        start_date=?, expiry_date=?, status=?, seats=?, amount=?, paid_amount=?, payment_status=?, payment_method=?, notes=?
       WHERE id=?`,
      [v.plan_id, v.client_name, v.contact_person, v.phone, v.email, v.gstin, v.start_date, v.expiry_date,
       v.status, v.seats, v.amount, v.paid_amount, v.payment_status, v.payment_method, v.notes, id]
    );
    await audit(req, 'LICENSE_UPDATE', 'client_license', id, {
      status: before.status === v.status ? undefined : `${before.status} -> ${v.status}`,
      expiry: before.expiry_date === v.expiry_date ? undefined : `${before.expiry_date} -> ${v.expiry_date}`,
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

async function renew(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM client_licenses WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    const lic = rows[0];
    const b = req.body || {};

    let plan = null;
    if (b.plan_id !== undefined && b.plan_id !== null && b.plan_id !== '') {
      const n = Number(b.plan_id);
      const [pp] = await pool.query('SELECT * FROM license_plans WHERE id=?', [n]);
      if (!pp.length) return res.status(400).json({ error: 'Plan not found.' });
      plan = pp[0];
    }

    const today = todayStr();
    const base = lic.expiry_date && lic.expiry_date > today ? lic.expiry_date : today;
    let newExpiry;
    if (plan && plan.type === 'LIFETIME') {
      newExpiry = null;
    } else if (plan && plan.duration_days) {
      newExpiry = addDays(base, Number(plan.duration_days));
    } else if (b.days !== undefined && b.days !== '') {
      const days = Number(b.days);
      if (!Number.isInteger(days) || days <= 0) return res.status(400).json({ error: 'Extension days must be positive.' });
      newExpiry = addDays(base, days);
    } else {
      return res.status(400).json({ error: 'Pick a renewal plan or an extension in days.' });
    }
    if (b.expiry_date !== undefined && b.expiry_date !== null && b.expiry_date !== '') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.expiry_date)) return res.status(400).json({ error: 'Invalid expiry date.' });
      newExpiry = b.expiry_date;
    }

    const amount = Math.max(0, Number(b.amount) || 0);
    const paid = Math.max(0, Number(b.paid_amount) || 0);
    const payStatus = b.payment_status ? String(b.payment_status).toUpperCase() : derivePaymentStatus(amount, paid);
    if (!PAY_STATUSES.includes(payStatus)) return res.status(400).json({ error: 'Please choose a valid payment status.' });
    const method = String(b.payment_method || '') || null;
    const notes = String(b.notes || '') || null;

    await pool.query(
      `INSERT INTO license_renewals (license_id, plan_id, from_date, to_date, amount, paid_amount, payment_status, payment_method, notes)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, plan ? plan.id : null, lic.expiry_date || lic.start_date, newExpiry || null, amount, paid, payStatus, method, notes]
    );

    const newStatus = plan && lic.status !== 'ACTIVE' ? 'ACTIVE' : lic.status;
    const newAmount = amount > 0 ? amount : lic.amount;
    await pool.query(
      `UPDATE client_licenses
       SET plan_id=?, expiry_date=?, status=?, amount=?, paid_amount=paid_amount+?, payment_status=?,
           payment_method=COALESCE(?, payment_method)
       WHERE id=?`,
      [
        plan ? plan.id : lic.plan_id, newExpiry || null,
        newStatus, newAmount, paid, derivePaymentStatus(newAmount, Number(lic.paid_amount) + paid),
        method, id,
      ]
    );
    await audit(req, 'LICENSE_RENEW', 'client_license', id, {
      from: lic.expiry_date || null, to: newExpiry || 'LIFETIME',
      amount, paid, plan_id: plan ? plan.id : null,
    });
    res.json({ ok: true, new_expiry: newExpiry, status: newStatus });
  } catch (e) { next(e); }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM client_licenses WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    await pool.query('DELETE FROM client_licenses WHERE id=?', [id]);
    await audit(req, 'LICENSE_DELETE', 'client_license', id, { client: rows[0].client_name });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

/**
 * POST /api/licensing/:id/invoice
 * Finds-or-creates a customer from the license, then raises a proper GST
 * sales invoice (SAC 998314 software licensing) for the license amount.
 * Optional paid_amount records payment against the invoice in the same step.
 */
async function invoice(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const b = req.body || {};
    const [rows] = await conn.query('SELECT * FROM client_licenses WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    const lic = rows[0];
    if (lic.invoice_id) return res.status(400).json({ error: 'An invoice already exists for this license.' });

    const amount = Math.max(0, Number(b.amount) || Number(lic.amount) || 0);
    if (amount <= 0) {
      return res.status(400).json({ error: 'Nothing billable: license amount is ₹0. Set an amount or pass one.' });
    }

    await conn.beginTransaction();

    // Find-or-create customer from the license record.
    let customerId = null;
    if (lic.gstin) {
      const [c] = await conn.query('SELECT id FROM customers WHERE gstin=? AND is_active=1 LIMIT 1', [lic.gstin]);
      if (c.length) customerId = c[0].id;
    }
    if (!customerId) {
      const [c] = await conn.query(
        'SELECT id FROM customers WHERE name=? AND phone<=>? AND email<=>? AND is_active=1 LIMIT 1',
        [lic.client_name, lic.phone || null, lic.email || null]
      );
      if (c.length) customerId = c[0].id;
    }
    if (!customerId) {
      const [[{ mx }]] = await conn.query('SELECT MAX(id) AS mx FROM customers');
      const customer_code = `CUST-${pad((mx || 0) + 1, 4)}`;
      const gstinOk = lic.gstin && isValidGstin(lic.gstin) ? lic.gstin : null;
      const [cr] = await conn.query(
        `INSERT INTO customers
         (customer_code,name,legal_name,company_name,gstin,phone,email,state_code,is_active,created_by)
         VALUES (?,?,?,?,?,?,?,?,1,?)`,
        [
          customer_code, lic.client_name, lic.client_name, lic.client_name, gstinOk || null,
          lic.phone || null, lic.email || null, gstinOk ? gstinOk.slice(0, 2) : null,
          req.user.id,
        ]
      );
      customerId = cr.insertId;
      await audit(req, 'CREATE', 'customer', customerId, { name: lic.client_name, gstin: gstinOk || null });
    }

    const gstRate = Number(b.gst_rate) || 18;
    const itemName = lic.plan_name ? `Software license: ${lic.plan_name}` : 'Software license';
    const paidAmount = Math.max(0, Number(b.paid_amount) || 0);
    const paymentMode = normalizeMode(b.payment_mode);
    const notes = `[Licensing] Client license #${lic.id}${b.notes ? ' — ' + String(b.notes) : ''}`;

    const result = await createInvoiceCore(conn, req.user, {
      customer_id: customerId,
      invoice_date: b.invoice_date || localDateStr(),
      due_date: b.due_date || null,
      payment_mode: paymentMode,
      paid_amount: paidAmount,
      reference_no: b.reference_no || null,
      notes,
      items: [{
        item_name: itemName,
        hsn_code: b.hsn_code || '998314',
        gst_rate: gstRate,
        quantity: 1,
        unit: 'SVC',
        unit_price: amount,
        discount: 0,
      }],
    });
    const { id: invoiceId, invoice_number, grand_total } = result.resp;

    const balance = round2Num(grand_total - paidAmount);
    await conn.query(
      `UPDATE client_licenses SET invoice_id=?, paid_amount=?, payment_status=?, payment_method=?
       WHERE id=?`,
      [invoiceId, Number(lic.paid_amount) + paidAmount, derivePaymentStatus(Math.max(amount, grand_total), Number(lic.paid_amount) + paidAmount), paymentMode, id]
    );
    await refreshCustomerBalance(conn, customerId);
    await conn.commit();
    await audit(req, 'LICENSE_INVOICE', 'client_license', id, {
      invoice_number, invoice_id: invoiceId, amount, paid: paidAmount, grand_total,
    });
    res.status(201).json({ ok: true, invoice_id: invoiceId, invoice_number, grand_total, balance_due: balance });
  } catch (e) {
    await conn.rollback();
    if (e instanceof Error && e.expose) return res.status(e.status || 400).json({ error: e.message });
    next(e);
  } finally {
    conn.release();
  }
}

function round2Num(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/**
 * POST /api/licensing/:id/pay
 * Records a payment against the license's linked invoice and syncs the
 * license payment status.
 */
async function pay(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid client id.' });
    const { amount, mode, reference_no, date, note } = req.body || {};
    if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Valid amount required.' });

    const [rows] = await conn.query('SELECT * FROM client_licenses WHERE id=? FOR UPDATE', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Client license not found.' });
    const lic = rows[0];
    if (!lic.invoice_id) {
      return res.status(400).json({ error: 'No invoice linked. Generate an invoice for this license first.' });
    }

    await conn.beginTransaction();
    const [inv] = await conn.query('SELECT * FROM invoices WHERE id=? FOR UPDATE', [lic.invoice_id]);
    if (!inv.length) throw Object.assign(new Error('Linked invoice not found.'), { status: 404 });
    const invoice = inv[0];
    if (invoice.status === 'CANCELLED') throw Object.assign(new Error('Cannot pay a cancelled invoice.'), { status: 400 });

    const pending = Number(invoice.balance_due);
    const payAmt = Math.min(Number(amount), pending);
    if (payAmt <= 0) return res.status(400).json({ error: 'Invoice is already fully paid.' });

    await conn.query(
      `INSERT INTO payments (invoice_id,customer_id,date,amount,mode,reference_no,note,created_by)
       VALUES (?,?,?,?,?,?,?,?)`,
      [invoice.id, invoice.customer_id, date || localDateStr(), payAmt, normalizeMode(mode), reference_no || null, note || null, req.user.id]
    );
    const newPaid = Math.round((Number(invoice.paid_amount) + payAmt) * 100) / 100;
    const newPending = Math.round((pending - payAmt) * 100) / 100;
    await conn.query(
      'UPDATE invoices SET paid_amount=?, balance_due=?, status=? WHERE id=?',
      [newPaid, newPending, newPending === 0 ? 'PAID' : 'PARTIAL', invoice.id]
    );
    const licPaid = Number(lic.paid_amount) + payAmt;
    await conn.query(
      'UPDATE client_licenses SET paid_amount=?, payment_status=?, payment_method=COALESCE(?, payment_method) WHERE id=?',
      [licPaid, derivePaymentStatus(Math.max(Number(lic.amount) || 0, Number(invoice.grand_total) || 0), licPaid), mode || null, id]
    );
    await refreshCustomerBalance(conn, invoice.customer_id);
    await conn.commit();
    await audit(req, 'LICENSE_PAY', 'client_license', id, {
      amount: payAmt, mode: mode || 'OTHER', invoice_id: invoice.id, invoice_number: invoice.invoice_number,
    });
    res.json({ message: 'Payment recorded.', balance_due: newPending });
  } catch (e) {
    await conn.rollback();
    if (e instanceof Error && e.expose) return res.status(e.status || 400).json({ error: e.message });
    next(e);
  } finally {
    conn.release();
  }
}

module.exports = { listPlans, createPlan, updatePlan, deletePlan, stats, list, get, create, update, renew, invoice, pay, remove };