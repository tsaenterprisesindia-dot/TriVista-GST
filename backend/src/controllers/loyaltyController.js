/**
 * loyaltyController.js — Stage 3 loyalty points.
 *
 * Rules (one active row in loyalty_rules):
 *   - earn:  floor(taxable / 100) * earn_points_per_100  on every paid sale for a
 *     registered customer (walk-in exempt).
 *   - burn:  1 point redeems `redeem_points_per_1` Rs. at POS, posted as a
 *     payment leg with mode='POINTS'.
 * Balance lives in customer_points (mirrored to customers.points_balance).
 */
const { getPool } = require('../db');
const { round2 } = require('../utils/gst');
const { resolveFeatures } = require('../config/modelPacks');

/**
 * Read the active loyalty rule (or null).
 */
async function activeRule(conn) {
  const [rows] = await conn.query(
    'SELECT * FROM loyalty_rules WHERE is_active=1 ORDER BY id DESC LIMIT 1'
  );
  return rows[0] || null;
}

/**
 * True when the company has the loyalty feature enabled.
 */
async function loyaltyEnabled(conn) {
  const [rows] = await conn.query('SELECT business_model, feature_flags FROM company_settings ORDER BY id LIMIT 1');
  const company = rows[0] || {};
  let overrides = null;
  if (company.feature_flags) {
    try {
      overrides = typeof company.feature_flags === 'string' ? JSON.parse(company.feature_flags) : company.feature_flags;
    } catch (_e) { overrides = null; }
  }
  const features = resolveFeatures({ businessModel: company.business_model, overrides });
  return features.loyalty === true;
}

/**
 * Earn points on a paid sale (called inside posSale's transaction).
 * Returns points earned (0 if ineligible).
 */
async function earnPoints(conn, { customer, invoice_id, invoice_number, date, taxable_value, created_by }) {
  const rule = await activeRule(conn);
  if (!rule) return 0;
  const taxable = Number(taxable_value) || 0;
  if (taxable < Number(rule.min_bill_amount)) return 0;
  const points = Math.floor(taxable / 100) * Number(rule.earn_points_per_100);
  if (points <= 0) return 0;
  await conn.query(
    `INSERT INTO customer_points (customer_id, points_balance, total_earned)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE
       points_balance = ROUND(points_balance + VALUES(points_balance), 2),
       total_earned   = ROUND(total_earned + VALUES(total_earned), 2)`,
    [customer.id, points, points]
  );
  await conn.query(
    `INSERT INTO points_ledger (customer_id,date,type,points,invoice_id,invoice_number,note,created_by)
     VALUES (?,?,'EARN',?,?,?,?,?)`,
    [customer.id, date, points, invoice_id, invoice_number, `Points on ${invoice_number}`, created_by]
  );
  await conn.query('UPDATE customers SET points_balance=ROUND(COALESCE(points_balance,0)+?,2) WHERE id=?', [points, customer.id]);
  return points;
}

/**
 * Burn points at POS redemption (called inside posSale's transaction).
 * Returns { points, value } redeemed; throws if balance is insufficient.
 */
async function burnPoints(conn, { customer, invoice_id, invoice_number, date, points, created_by }) {
  const rule = await activeRule(conn);
  if (!rule) return { points: 0, value: 0 };
  const want = Math.floor(Number(points) || 0);
  if (want <= 0) return { points: 0, value: 0 };
  const [rows] = await conn.query('SELECT points_balance FROM customer_points WHERE customer_id=? FOR UPDATE', [customer.id]);
  const balance = rows.length ? Number(rows[0].points_balance) : 0;
  if (want > balance + 0.0001) {
    throw Object.assign(
      new Error(`Cannot redeem ${want} points — balance is ${balance}.`),
      { status: 400, expose: true }
    );
  }
  const value = round2(want * Number(rule.redeem_points_per_1));
  await conn.query(
    `UPDATE customer_points SET points_balance=ROUND(points_balance-?,2), total_burned=ROUND(total_burned+?,2) WHERE customer_id=?`,
    [want, want, customer.id]
  );
  const [led] = await conn.query(
    `INSERT INTO points_ledger (customer_id,date,type,points,invoice_id,invoice_number,note,created_by)
     VALUES (?,?,'BURN',?,?,?,?,?)`,
    [customer.id, date, -want, invoice_id, invoice_number, `Redeemed ${value} on ${invoice_number}`, created_by]
  );
  await conn.query('UPDATE customers SET points_balance=ROUND(COALESCE(points_balance,0)-?,2) WHERE id=?', [want, customer.id]);
  return { points: want, value, ledger_id: led.insertId };
}

/**
 * GET /api/loyalty/rules — active rule + balance summary counts.
 */
async function getRules(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT * FROM loyalty_rules ORDER BY (is_active = 1) DESC, id DESC LIMIT 1`
    );
    const [stat] = await getPool().query(
      `SELECT IFNULL(COUNT(DISTINCT customer_id),0) AS members,
              IFNULL(SUM(points_balance),0) AS points_outstanding
       FROM customer_points`
    );
    res.json({ rules: rows[0] || null, members: stat[0].members, points_outstanding: stat[0].points_outstanding });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/loyalty/rules — update the active rule set (ADMIN/SUPER_ADMIN).
 */
async function updateRules(req, res, next) {
  try {
    const b = req.body || {};
    const id = Number(b.id) || 0;
    const fields = {
      name: String(b.name || 'Default').slice(0, 90),
      earn_points_per_100: round2(Number(b.earn_points_per_100) || 0),
      redeem_points_per_1: round2(Number(b.redeem_points_per_1) || 0),
      min_bill_amount: round2(Number(b.min_bill_amount) || 0),
      expiry_months: Math.max(0, Math.min(255, Math.round(Number(b.expiry_months) || 0))),
      is_active: b.is_active === undefined ? 1 : (b.is_active ? 1 : 0),
    };
    const pool = getPool();
    if (id) {
      await pool.query(
        `UPDATE loyalty_rules SET name=?, earn_points_per_100=?, redeem_points_per_1=?, min_bill_amount=?, expiry_months=?, is_active=? WHERE id=?`,
        [fields.name, fields.earn_points_per_100, fields.redeem_points_per_1, fields.min_bill_amount, fields.expiry_months, fields.is_active, id]
      );
    } else {
      await pool.query(
        `INSERT INTO loyalty_rules (name, earn_points_per_100, redeem_points_per_1, min_bill_amount, expiry_months, is_active, created_by)
         VALUES (?,?,?,?,?,?,?)`,
        [fields.name, fields.earn_points_per_100, fields.redeem_points_per_1, fields.min_bill_amount, fields.expiry_months, fields.is_active, req.user.id]
      );
    }
    res.json({ ok: true, ...fields, id });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/loyalty/customers/:id — balance + full ledger.
 */
async function customerPoints(req, res, next) {
  try {
    const pool = getPool();
    const customerId = Number(req.params.id);
    const [cust] = await pool.query(
      'SELECT id, customer_code, name, points_balance FROM customers WHERE id=?', [customerId]
    );
    if (!cust.length) return res.status(404).json({ error: 'Customer not found.' });
    const [ledger] = await pool.query(
      `SELECT * FROM points_ledger WHERE customer_id=? ORDER BY id DESC LIMIT 300`, [customerId]
    );
    const [agg] = await pool.query(
      `SELECT IFNULL(SUM(CASE WHEN points>0 THEN points ELSE 0 END),0) AS earned,
              IFNULL(SUM(CASE WHEN points<0 THEN -points ELSE 0 END),0) AS burned
       FROM points_ledger WHERE customer_id=?`, [customerId]
    );
    res.json({
      customer: cust[0],
      points_balance: Number(cust[0].points_balance),
      earned: agg[0].earned,
      burned: agg[0].burned,
      ledger,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/loyalty/adjust — manual +/- adjustment (ADMIN/SUPER_ADMIN).
 * body: { customer_id, points (+/-), reason }
 */
async function adjust(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    const customerId = Number(b.customer_id);
    const points = round2(Number(b.points) || 0);
    if (!customerId) throw Object.assign(new Error('customer_id is required.'), { status: 400, expose: true });
    if (!points) throw Object.assign(new Error('points must be non-zero.'), { status: 400, expose: true });
    const reason = String(b.reason || '').trim().slice(0, 255) || 'Manual adjustment';

    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT * FROM customers WHERE id=? FOR UPDATE', [customerId]);
    if (!rows.length) throw Object.assign(new Error('Customer not found.'), { status: 404, expose: true });

    await conn.query(
      `INSERT INTO customer_points (customer_id, points_balance, total_earned, total_burned)
       VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE
         points_balance = ROUND(points_balance + VALUES(points_balance), 2),
         total_earned   = ROUND(total_earned + ?, 2),
         total_burned   = ROUND(total_burned + ?, 2)`,
      [
        customerId,
        points,
        points > 0 ? points : 0,
        points < 0 ? -points : 0,
        points > 0 ? points : 0,
        points < 0 ? -points : 0,
      ]
    );
    await conn.query(
      `INSERT INTO points_ledger (customer_id,date,type,points,note,created_by)
       VALUES (?,CURDATE(),'ADJUST',?,?,?)`,
      [customerId, points, reason, req.user.id]
    );
    const [[agg]] = await conn.query(
      'SELECT points_balance FROM customer_points WHERE customer_id=?', [customerId]
    );
    await conn.query(
      'UPDATE customers SET points_balance=? WHERE id=?', [agg.points_balance, customerId]
    );
    await conn.commit();
    res.json({ ok: true, customer_id: customerId, points, balance: agg.points_balance });
  } catch (e) {
    await conn.rollback();
    if (e instanceof Error && e.expose) return res.status(e.status).json({ error: e.message });
    next(e);
  } finally {
    conn.release();
  }
}

module.exports = { getRules, updateRules, customerPoints, adjust, activeRule, loyaltyEnabled, earnPoints, burnPoints };