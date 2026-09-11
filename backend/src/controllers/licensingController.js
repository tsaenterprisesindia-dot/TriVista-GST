const { getPool } = require('../db');
const { audit } = require('../utils/audit');

const PLAN_TYPES = ['TRIAL', 'SUBSCRIPTION', 'ONETIME', 'LIFETIME'];
const LIC_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'PAST_DUE', 'CANCELLED'];
const PAY_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'];

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
    res.json(rows);
  } catch (e) { next(e); }
}

async function createPlan(req, res, next) {
  try {
    const { name, type, duration_days, price, seats, is_active } = req.body || {};
    const t = String(type || '').toUpperCase();
    if (!PLAN_TYPES.includes(t)) return res.status(400).json({ error: 'Please choose a valid plan type.' });
    const nm = String(name || '').trim();
    if (nm.length < 3 || nm.length > 120) return res.status(400).json({ error: 'Plan name must be between 3 and 120 characters.' });
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
      `INSERT INTO license_plans (name, type, duration_days, price, seats, is_active)
       VALUES (?,?,?,?,?,?)`,
      [nm, t, days, priceVal, seatsVal, is_active === undefined ? 1 : is_active ? 1 : 0]
    );
    await audit(req, 'PLAN_CREATE', 'license_plan', r.insertId, { name: nm, type: t, price: priceVal });
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
    const nm = String(p.name || '').trim();
    if (nm.length < 3 || nm.length > 120) return res.status(400).json({ error: 'Plan name must be between 3 and 120 characters.' });
    await pool.query(
      `UPDATE license_plans SET name=?, type=?, duration_days=?, price=?, seats=?, is_active=? WHERE id=?`,
      [nm, p.type, p.duration_days, p.price, p.seats, p.is_active, id]
    );
    await audit(req, 'PLAN_UPDATE', 'license_plan', id, { name: nm, type: p.type, price: p.price });
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
    res.json({
      total,
      active: countOf('ACTIVE'),
      trials: countOf('TRIAL'),
      past_due: countOf('PAST_DUE'),
      expired: countOf('EXPIRED'),
      cancelled: countOf('CANCELLED'),
      expiring_soon: Number(expiring),
      renewals: Number(renewals),
      invoiced: Number(invoiced),
      paid: Number(paid),
      arrears: Number(arrears),
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
      `SELECT l.*, p.name AS plan_name, p.type AS plan_type
       FROM client_licenses l
       LEFT JOIN license_plans p ON p.id = l.plan_id
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
      `SELECT l.*, p.name AS plan_name, p.type AS plan_type
       FROM client_licenses l LEFT JOIN license_plans p ON p.id = l.plan_id WHERE l.id=?`,
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

module.exports = { listPlans, createPlan, updatePlan, deletePlan, stats, list, get, create, update, renew, remove };