const crypto = require('crypto');
const { getPool } = require('../db');

// ---------------- API key management (internal) ----------------
async function listClients(_req, res, next) {
  try {
    const [rows] = await getPool().query(
      'SELECT id,client_name,scopes,is_active,last_used_at,created_at FROM api_clients ORDER BY id'
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

function genKey() {
  return 'tg_' + crypto.randomBytes(24).toString('hex');
}

async function createClient(req, res, next) {
  try {
    const { client_name, scopes } = req.body || {};
    if (!client_name) return res.status(400).json({ error: 'client_name is required.' });
    const key = genKey();
    const [r] = await getPool().query(
      'INSERT INTO api_clients (client_name,api_key,scopes) VALUES (?,?,?)',
      [client_name, key, scopes || 'read']
    );
    res.status(201).json({ id: r.insertId, client_name, api_key: key, message: 'API key created (shown once).' });
  } catch (e) {
    next(e);
  }
}

async function revokeClient(req, res, next) {
  try {
    await getPool().query('UPDATE api_clients SET is_active=0 WHERE id=?', [Number(req.params.id)]);
    res.json({ message: 'API key revoked.' });
  } catch (e) {
    next(e);
  }
}

// ---------------- Public read API (v1) ----------------
async function publicProducts(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT p.sku,p.barcode,p.name,p.hsn_code,p.gst_rate,p.unit,p.selling_price,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS stock_on_hand
       FROM products p LEFT JOIN stock_movements sm ON sm.product_id=p.id
       WHERE p.is_active=1 GROUP BY p.id ORDER BY p.name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function publicInvoices(req, res, next) {
  try {
    const { from, to, page = 1, limit = 50 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (from) where.push('i.invoice_date >= ?'), params.push(from);
    if (to) where.push('i.invoice_date <= ?'), params.push(to);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);
    const [rows] = await pool.query(
      `SELECT i.invoice_number,i.invoice_date,i.customer_name,i.customer_gstin,i.invoice_type,
              i.is_interstate,i.status,i.subtotal,i.tax_total,i.grand_total,i.paid_amount,i.balance_due
       FROM invoices i ${whereSql} ORDER BY i.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function publicStock(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT p.sku,p.name,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS stock_on_hand,
              p.min_stock,p.unit
       FROM products p LEFT JOIN stock_movements sm ON sm.product_id=p.id
       WHERE p.is_service=0 GROUP BY p.id,p.sku,p.name,p.min_stock,p.unit ORDER BY p.name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function publicGstSummary(req, res, next) {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from and to required (YYYY-MM-DD).' });
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT invoice_date, COUNT(*) AS invoices,
              IFNULL(SUM(subtotal),0) AS taxable_value,
              IFNULL(SUM(cgst_total),0) AS cgst,
              IFNULL(SUM(sgst_total),0) AS sgst,
              IFNULL(SUM(utgst_total),0) AS utgst,
              IFNULL(SUM(igst_total),0) AS igst,
              IFNULL(SUM(cess_total),0) AS cess,
              IFNULL(SUM(tax_total),0) AS total_tax,
              IFNULL(SUM(grand_total),0) AS grand_total
       FROM invoices WHERE invoice_date BETWEEN ? AND ? AND status NOT IN ('CANCELLED')
       GROUP BY invoice_date ORDER BY invoice_date`, [from, to]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listClients,
  createClient,
  revokeClient,
  publicProducts,
  publicInvoices,
  publicStock,
  publicGstSummary,
};