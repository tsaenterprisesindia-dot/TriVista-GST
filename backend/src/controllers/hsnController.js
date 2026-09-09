const { getPool } = require('../db');

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

module.exports = { list };