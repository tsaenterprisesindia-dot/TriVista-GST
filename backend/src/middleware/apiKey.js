const { getPool } = require('../db');

/**
 * API key auth for public /v1 endpoints.
 * Header: x-api-key
 */
async function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (!key) return res.status(401).json({ error: 'x-api-key header required.' });
  try {
    const [rows] = await getPool().query(
      'SELECT id, client_name, scopes, is_active FROM api_clients WHERE api_key=? AND is_active=1',
      [key]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid or inactive API key.' });
    await getPool().query('UPDATE api_clients SET last_used_at=NOW() WHERE id=?', [rows[0].id]);
    req.apiClient = rows[0];
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { apiKeyAuth };