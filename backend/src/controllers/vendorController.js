const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');

async function list(req, res, next) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR gstin LIKE ? OR vendor_code LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);
    const [rows] = await pool.query(
      `SELECT id,vendor_code,name,gstin,phone,email,address_line1,city,state,state_code,pincode,opening_balance,is_active,created_at
       FROM vendors ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM vendors ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name is required.' });
    if (b.gstin && !isValidGstin(b.gstin)) return res.status(400).json({ error: 'Invalid GSTIN format.' });
    const pool = getPool();
    const [mx] = await pool.query('SELECT COALESCE(MAX(id),0) AS mx FROM vendors');
    const code = `VEND-${pad((mx[0].mx || 0) + 1, 4)}`;
    const [r] = await pool.query(
      `INSERT INTO vendors (vendor_code,name,gstin,phone,email,address_line1,city,state,state_code,pincode,opening_balance)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [code, b.name, b.gstin || null, b.phone || null, b.email || null,
       b.address_line1 || null, b.city || null, b.state || null, b.state_code || null, b.pincode || null,
       Number(b.opening_balance) || 0]
    );
    res.status(201).json({ id: r.insertId, vendor_code: code, message: 'Vendor created.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create };