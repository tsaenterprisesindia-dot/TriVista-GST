const { getPool } = require('../db');

/**
 * GET /api/audit - immutable edit-log view (who/what/when) for every
 * transaction affecting the books of account. Audit-accessible to
 * ADMIN / SUPER_ADMIN / ACCOUNTANT.
 */
async function list(req, res, next) {
  try {
    const { entity, q, from, to, limit = 100 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (entity) { where.push('a.entity=?'); params.push(entity); }
    if (q) { where.push('(u.name LIKE ? OR a.action LIKE ? OR a.details LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    if (from) { where.push('a.created_at >= ?'); params.push(`${from} 00:00:00`); }
    if (to) { where.push('a.created_at <= ?'); params.push(`${to} 23:59:59`); }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const n = Math.min(Number(limit) || 100, 500);
    const [rows] = await pool.query(
      `SELECT a.id,a.action,a.entity,a.entity_id,a.details,a.ip,a.created_at,
              u.name AS user_name, u.email AS user_email
       FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
       ${whereSql} ORDER BY a.id DESC LIMIT ?`,
      [...params, n]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${whereSql}`,
      params
    );
    res.json({ data: rows, total });
  } catch (e) {
    next(e);
  }
}

module.exports = { list };