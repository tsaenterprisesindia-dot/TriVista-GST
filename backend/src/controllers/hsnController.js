const { getPool } = require('../db');
const { applyRateChange } = require('../utils/rateHistory');
const { audit } = require('../utils/audit');

async function list(req, res, next) {
  try {
    const { q, type } = req.query;
    const pool = getPool();
    let sql = 'SELECT * FROM hsn_sac_codes';
    const params = [];
    const where = [];
    if (q) {
      where.push('(code LIKE ? OR description LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    if (type) {
      where.push('type = ?');
      params.push(type);
    }
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY code LIMIT 200';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Rate timeline for one HSN/SAC: current master + effective-dated history.
 */
async function rates(req, res, next) {
  try {
    const code = String(req.params.code || '').trim();
    const pool = getPool();
    const [m] = await pool.query('SELECT * FROM hsn_sac_codes WHERE code=? LIMIT 1', [code]);
    if (!m.length) return res.status(404).json({ error: 'HSN/SAC code not found.' });
    const [history] = await pool.query(
      'SELECT * FROM hsn_sac_rate_history WHERE hsn_sac_id=? ORDER BY effective_from ASC',
      [m[0].id]
    );
    res.json({ code: m[0].code, description: m[0].description, type: m[0].type, current: m[0], history });
  } catch (e) {
    next(e);
  }
}

/**
 * Record a dated rate change for an HSN/SAC code and update the master.
 * body: { code, effective_from, gst_rate, cess_rate?, source?, notes? }
 */
async function createRateChange(req, res, next) {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    const b = req.body || {};
    await conn.beginTransaction();
    const result = await applyRateChange(conn, {
      code: String(b.code || '').trim(),
      effectiveFrom: b.effective_from,
      gstRate: b.gst_rate,
      cessRate: b.cess_rate,
      source: b.source || null,
      notes: b.notes || null,
      createdBy: req.user.id,
    });
    await audit(req, 'CREATE', 'hsn_rate', result.historyId, {
      code: String(b.code || '').trim(),
      effective_from: b.effective_from,
      gst_rate: Number(b.gst_rate),
      cess_rate: b.cess_rate,
    });
    await conn.commit();
    res.status(201).json({ id: result.historyId, message: 'Rate change recorded.', backfilled: result.backfilled });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally {
    conn.release();
  }
}

module.exports = { list, rates, createRateChange };