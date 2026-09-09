const { getPool } = require('../db');

/**
 * Persist an audit trail entry (Companies Act s.128 / Rule 3(1) Accounts Rules:
 * who, what, when for every transaction affecting the books of account).
 * The trail cannot be disabled and is written on every mutation.
 *
 * req   - the Express request (req.user.id + req.ip are used when available)
 * action- e.g. 'CREATE','UPDATE','DELETE','PAY','CANCEL','LOGIN','LOGIN_FAIL'
 * entity- e.g. 'invoice','payment','purchase_bill','product','customer','user'
 * entityId - primary key of the affected record (optional)
 * details - object stored as JSON (before/after diffs are encouraged)
 */
async function audit(req, action, entity, entityId, details) {
  try {
    const userId = req?.user?.id ?? null;
    const ip = String(req?.ip || req?.connection?.remoteAddress || '').slice(0, 45);
    await getPool().query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip)
       VALUES (?,?,?,?,?,?)`,
      [userId, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, ip || null]
    );
  } catch (e) {
    // Audit never breaks the business operation.
    console.error('[audit]', e.message);
  }
}

/** Shorthand audit call usable without a request object. */
async function auditRaw({ userId, action, entity, entityId, details, ip } = {}) {
  try {
    await getPool().query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip)
       VALUES (?,?,?,?,?,?)`,
      [userId ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, ip ?? null]
    );
  } catch (e) {
    console.error('[audit]', e.message);
  }
}

module.exports = { audit, auditRaw };