const { getPool } = require('../db');
const { audit } = require('../utils/audit');

const CATEGORIES = ['SUGGESTION', 'FEEDBACK', 'COMMENT', 'COMPLAINT', 'REQUEST', 'TECHNICAL_SUPPORT', 'OTHER'];
const STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];

/**
 * POST /api/feedback
 * Any authenticated user (including VIEWER) can submit a message.
 */
async function create(req, res, next) {
  try {
    const { category, subject, message } = req.body || {};
    const cat = String(category || '').toUpperCase();
    if (!CATEGORIES.includes(cat)) {
      return res.status(400).json({ error: 'Please choose a valid category.' });
    }
    const subj = String(subject || '').trim();
    const msg = String(message || '').trim();
    if (subj.length < 3 || subj.length > 200) {
      return res.status(400).json({ error: 'Subject must be between 3 and 200 characters.' });
    }
    if (msg.length < 3 || msg.length > 8000) {
      return res.status(400).json({ error: 'Message must be between 3 and 8000 characters.' });
    }
    const pool = getPool();
    const [r] = await pool.query(
      `INSERT INTO support_messages (category, subject, message, user_id, user_name, user_email)
       VALUES (?,?,?,?,?,?)`,
      [cat, subj, msg, req.user.id, req.user.name || null, req.user.email || null]
    );
    await audit(req, 'FEEDBACK_CREATE', 'support_message', r.insertId, { category: cat, subject: subj });
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/feedback - list all submissions (category/status/search filters).
 * Visible to every authenticated user so experiences are shared.
 */
async function list(req, res, next) {
  try {
    const { category, status, q, limit = 100 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (category) {
      where.push('s.category = ?');
      params.push(String(category).toUpperCase());
    }
    if (status) {
      where.push('s.status = ?');
      params.push(String(status).toUpperCase());
    }
    if (q) {
      where.push('(s.subject LIKE ? OR s.message LIKE ? OR s.user_name LIKE ? OR s.reply LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const n = Math.min(Number(limit) || 100, 500);
    const [rows] = await pool.query(
      `SELECT s.id, s.category, s.subject, s.message, s.user_id, s.user_name, s.user_email,
              s.status, s.reply, s.replied_by, s.replied_at, s.created_at, s.updated_at,
              ru.name AS replied_by_name
       FROM support_messages s
       LEFT JOIN users ru ON ru.id = s.replied_by
       ${whereSql}
       ORDER BY s.id DESC LIMIT ?`,
      [...params, n]
    );
    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM support_messages s ${whereSql}`,
      params
    );
    res.json({ data: rows, total });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/feedback/:id - manage status and reply (ADMIN / SUPER_ADMIN).
 */
async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid message id.' });
    }
    const { status, reply } = req.body || {};
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM support_messages WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Message not found.' });
    }
    const before = rows[0];
    const newStatus = String(status ?? before.status).toUpperCase();
    if (!STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: 'Please choose a valid status.' });
    }
    let newReply = before.reply;
    if (reply !== undefined && reply !== null) {
      newReply = String(reply).trim() === '' ? null : String(reply).slice(0, 8000);
    }
    await pool.query(
      `UPDATE support_messages
       SET status = ?, reply = ?,
           replied_by = ?, replied_at = NOW()
       WHERE id = ?`,
      [newStatus, newReply, req.user.id, id]
    );
    await audit(req, 'FEEDBACK_UPDATE', 'support_message', id, {
      status: `${before.status} -> ${newStatus}`,
      reply_changed: before.reply !== newReply,
    });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /api/feedback/:id - creator or ADMIN / SUPER_ADMIN.
 */
async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid message id.' });
    }
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM support_messages WHERE id = ?', [id]);
    if (!rows.length) {
      return res.status(404).json({ error: 'Message not found.' });
    }
    const isManager = ['ADMIN', 'SUPER_ADMIN'].includes(req.user.role);
    if (!isManager && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete messages you submitted.' });
    }
    await pool.query('DELETE FROM support_messages WHERE id = ?', [id]);
    await audit(req, 'FEEDBACK_DELETE', 'support_message', id, { subject: rows[0].subject });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
}

module.exports = { create, list, update, remove };