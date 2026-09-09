const { getPool } = require('../db');
const { query } = require('../db');

/**
 * Stock on hand per product (reactive, computed from movements).
 */
async function stockOnHand(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.id,p.sku,p.name,p.category_id,c.name AS category_name,p.unit,p.min_stock,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS stock_on_hand
       FROM products p
       LEFT JOIN stock_movements sm ON sm.product_id=p.id
       LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.is_service=0
       GROUP BY p.id,p.sku,p.name,p.category_id,c.name,p.unit,p.min_stock
       HAVING stock_on_hand <> 0
       ORDER BY p.name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function stockReport(req, res, next) {
  try {
    const { lowOnly } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT p.id,p.sku,p.name,p.unit,p.purchase_price AS avg_cost,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS stock_on_hand,
              p.min_stock,
              ROUND(IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) * p.purchase_price,2) AS stock_value
       FROM products p
       LEFT JOIN stock_movements sm ON sm.product_id=p.id
       WHERE p.is_service=0
       GROUP BY p.id,p.sku,p.name,p.unit,p.purchase_price,p.min_stock
       ${lowOnly ? 'HAVING stock_on_hand <= p.min_stock' : ''}
       ORDER BY p.name`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Add stock (Purchase/IN) etc.
 * body: { product_id, type: IN|OUT|ADJUST, quantity, unit_cost, note }
 */
async function addMovement(req, res, next) {
  try {
    const { product_id, type, quantity, unit_cost, note } = req.body || {};
    if (!product_id) return res.status(400).json({ error: 'product_id is required.' });
    if (!['IN','OUT','ADJUST'].includes(type)) return res.status(400).json({ error: 'type must be IN/OUT/ADJUST.' });
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be positive.' });
    const pool = getPool();
    if (type === 'OUT') {
      const [cur] = await pool.query(
        `SELECT IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS stock
         FROM stock_movements sm WHERE sm.product_id=?`,
        [product_id]
      );
      if (Number(cur[0].stock) < qty) {
        return res.status(400).json({ error: `Insufficient stock. Only ${cur[0].stock} available.` });
      }
    }
    const [r] = await pool.query(
      `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,note,created_by)
       VALUES (?,?,?,?,?,?)`,
      [product_id, type, qty, unit_cost || null, note || null, req.user.id]
    );
    // If OUT update invoice reference not handled here (invoice flow does it directly)
    res.status(201).json({ id: r.insertId, message: 'Stock movement recorded.' });
  } catch (e) {
    next(e);
  }
}

/**
 * Movement history for a product.
 */
async function movements(req, res, next) {
  try {
    const { product_id } = req.query;
    const pool = getPool();
    if (product_id) {
      const [rows] = await pool.query(
        `SELECT sm.*, p.name AS product_name, u.name AS created_by_name
         FROM stock_movements sm
         LEFT JOIN products p ON p.id=sm.product_id
         LEFT JOIN users u ON u.id=sm.created_by
         WHERE sm.product_id=? ORDER BY sm.created_at DESC LIMIT 200`,
        [Number(product_id)]
      );
      return res.json(rows);
    }
    const [rows] = await pool.query(
      `SELECT sm.*, p.name AS product_name, u.name AS created_by_name
       FROM stock_movements sm
       LEFT JOIN products p ON p.id=sm.product_id
       LEFT JOIN users u ON u.id=sm.created_by
       ORDER BY sm.created_at DESC LIMIT 300`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

module.exports = { stockOnHand, stockReport, addMovement, movements };