const { getPool } = require('../db');
const { query } = require('../db');
const { audit } = require('../utils/audit');
const lots = require('../utils/lots');

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
 * Add stock (Purchase/IN), issue stock (OUT) or adjust.
 * body: { product_id, type: IN|OUT|ADJUST, quantity, unit_cost, note,
 *         batch_no, expiry_date, mfg_date, serial_numbers }
 */
async function addMovement(req, res, next) {
  try {
    const { product_id, type, quantity, unit_cost, note, batch_no, serial_numbers, expiry_date, mfg_date } = req.body || {};
    if (!product_id) return res.status(400).json({ error: 'product_id is required.' });
    if (!['IN', 'OUT', 'ADJUST'].includes(type)) return res.status(400).json({ error: 'type must be IN/OUT/ADJUST.' });
    const qty = Number(quantity);
    if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Quantity must be positive.' });
    const pool = getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [prods] = await conn.query('SELECT name, track_batch, track_serial FROM products WHERE id=?', [product_id]);
      if (!prods.length) throw Object.assign(new Error('Product not found.'), { status: 404 });
      const p = prods[0];
      const track = { track_batch: p.track_batch, track_serial: p.track_serial };

      let movementId = null;
      if (type === 'OUT' && track.track_batch) {
        const inserted = await lots.issueForSale(conn, {
          product_id, qty, note: note || 'Stock out', created_by: req.user.id,
          reference_type: 'adjustment', reference_id: null,
        });
        movementId = inserted[0] ? inserted[0].id : null;
        if (inserted.length > 1) {
          const ph = inserted.map(() => '?').join(',');
          await conn.query(`UPDATE stock_movements SET reference_id=? WHERE id IN (${ph})`, [movementId, ...inserted.map((m) => m.id)]);
        }
      } else {
        if (type === 'OUT') {
          const cur = await lots.onHand(conn, product_id);
          if (Number(cur) < qty) {
            throw Object.assign(new Error(`Insufficient stock. Only ${cur} available.`), { status: 400 });
          }
        }
        let batchId = null;
        if (batch_no || track.track_batch) {
          if (track.track_batch && !batch_no) {
            throw Object.assign(new Error(`Product "${p.name}" is batch-tracked — provide a batch number.`), { status: 400 });
          }
          batchId = await lots.getOrCreateLot(conn, {
            product_id, batch_no, expiry_date, mfg_date, created_by: req.user.id,
          });
        }
        movementId = await lots.recordIn(conn, {
          product_id, qty, unit_cost,
          note: note || (type === 'OUT' ? 'Stock out' : 'Stock in'),
          created_by: req.user.id, reference_type: 'adjustment', reference_id: null,
          track: { track_batch: track.track_batch, track_serial: track.track_serial, batch_id: batchId, serial_numbers },
          type,
        });
      }
      await conn.query('UPDATE stock_movements SET reference_id=? WHERE id=?', [movementId, movementId]);
      await conn.commit();
      await audit(req, type, 'stock', movementId, {
        product_id, product_name: p.name, quantity: qty, unit_cost: unit_cost || null,
        note: note || null, batch_no: batch_no || null, expiry_date: expiry_date || null,
      });
      res.status(201).json({ id: movementId, message: 'Stock movement recorded.' });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
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
    const before = `SELECT sm.*, lb.batch_no, p.name AS product_name, u.name AS created_by_name
         FROM stock_movements sm
         LEFT JOIN products p ON p.id=sm.product_id
         LEFT JOIN lot_batches lb ON lb.id=sm.batch_id
         LEFT JOIN users u ON u.id=sm.created_by`;
    if (product_id) {
      const [rows] = await pool.query(
        before + ` WHERE sm.product_id=? ORDER BY sm.created_at DESC LIMIT 200`,
        [Number(product_id)]
      );
      return res.json(rows);
    }
    const [rows] = await pool.query(
      before + ' ORDER BY sm.created_at DESC LIMIT 300'
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Per-batch stock with expiry visibility (batch lot master + reactive qty).
 */
async function batches(req, res, next) {
  try {
    const { product_id } = req.query;
    const pool = getPool();
    const [rows] = await pool.query(
      `SELECT l.id, l.product_id, p.name AS product_name, p.sku, p.track_batch, p.track_serial,
              l.batch_no, l.mfg_date, l.expiry_date,
              IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0) AS on_hand,
              MAX(CASE WHEN sm.type='IN' THEN sm.unit_cost END) AS unit_cost
       FROM lot_batches l
       JOIN products p ON p.id=l.product_id
       LEFT JOIN stock_movements sm ON sm.batch_id=l.id
       ${product_id ? 'WHERE l.product_id=?' : ''}
       GROUP BY l.id, l.product_id, p.name, p.sku, p.track_batch, p.track_serial, l.batch_no, l.mfg_date, l.expiry_date
       HAVING on_hand <> 0 OR (l.expiry_date IS NOT NULL)
       ORDER BY IFNULL(l.expiry_date,'9999-12-31') ASC, l.product_id, l.id`,
      product_id ? [product_id] : []
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

/**
 * Remaining serialised units per product (IN serials minus issued serials).
 */
async function serials(req, res, next) {
  try {
    const pool = getPool();
    const [movs] = await pool.query(
      `SELECT sm.product_id, sm.batch_id, sm.type, sm.serial_numbers
       FROM stock_movements sm
       JOIN products p ON p.id=sm.product_id
       WHERE p.track_serial=1 AND sm.serial_numbers IS NOT NULL AND sm.serial_numbers<>''
       ORDER BY sm.id`
    );
    const per = new Map();
    for (const m of movs) {
      const key = `${m.product_id}:${m.batch_id || 'null'}`;
      const list = String(m.serial_numbers).split(',').map((s) => s.trim()).filter(Boolean);
      if (!per.has(key)) per.set(key, { product_id: m.product_id, batch_id: m.batch_id, in: [], out: [] });
      const slot = per.get(key);
      (m.type === 'OUT' ? slot.out : slot.in).push(...list);
    }
    const rows = [];
    for (const { product_id, batch_id, in: ins, out } of per.values()) {
      const issued = new Set();
      for (const s of out) issued.add(s);
      const remaining = ins.filter((s) => !issued.has(s));
      rows.push({ product_id, batch_id, batch_no: null, total_received: ins.length, total_issued: out.length, remaining: remaining.length, serials: remaining.slice(0, 25) });
    }
    for (const r of rows) {
      if (r.batch_id) {
        const [b] = await pool.query('SELECT batch_no FROM lot_batches WHERE id=?', [r.batch_id]);
        r.batch_no = b[0]?.batch_no || null;
      }
      const [p] = await pool.query('SELECT name, sku FROM products WHERE id=?', [r.product_id]);
      r.product_name = p[0]?.name || null;
      r.sku = p[0]?.sku || null;
    }
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

module.exports = { stockOnHand, stockReport, addMovement, movements, batches, serials };