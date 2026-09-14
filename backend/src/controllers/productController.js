const { getPool } = require('../db');
const { audit } = require('../utils/audit');
const lots = require('../utils/lots');

// ------------- Categories -------------
async function listCategories(_req, res, next) {
  try {
    const [rows] = await getPool().query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (e) {
    next(e);
  }
}

async function createCategory(req, res, next) {
  try {
    const { name, description } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    try {
      const [r] = await getPool().query('INSERT INTO categories (name,description) VALUES (?,?)', [name, description || null]);
      await audit(req, 'CREATE', 'category', r.insertId, { name });
      res.status(201).json({ id: r.insertId, message: 'Category created.' });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category already exists.' });
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

// ------------- Products -------------
/**
 * List products with available stock and category.
 */
async function list(req, res, next) {
  try {
    const { q, category_id, page = 1, limit = 50 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.hsn_code LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (category_id) {
      where.push('p.category_id = ?');
      params.push(Number(category_id));
    }
    where.push('p.is_active = 1');
    const whereSql = 'WHERE ' + where.join(' AND ');
    const offset = (Number(page) - 1) * Number(limit);

    const [rows] = await pool.query(
      `SELECT p.id,p.sku,p.barcode,p.name,p.description,p.category_id,c.name AS category_name,
              p.hsn_code,p.hsn_id,p.gst_rate,p.cess_rate,p.unit,p.selling_price,p.wholesale_price,p.distributor_price,p.purchase_price,p.mrp,p.min_stock,
              p.track_batch,p.track_serial,p.weight_kg,p.is_service,p.is_active,p.created_at,
              IFNULL((SELECT SUM(
                 CASE WHEN sm.type='IN' THEN sm.quantity
                      WHEN sm.type='OUT' THEN -sm.quantity
                      WHEN sm.type='ADJUST' THEN sm.quantity END
              ) FROM stock_movements sm WHERE sm.product_id=p.id),0) AS stock_on_hand
       FROM products p
       LEFT JOIN categories c ON c.id=p.category_id
       ${whereSql}
       ORDER BY p.id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM products p ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

async function get(req, res, next) {
  try {
    const [rows] = await getPool().query(
      `SELECT p.*, c.name AS category_name,
        IFNULL((SELECT SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END)
                FROM stock_movements sm WHERE sm.product_id=p.id),0) AS stock_on_hand
       FROM products p LEFT JOIN categories c ON c.id=p.category_id
       WHERE p.id=?`,
      [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Product name is required.' });
    if (!b.hsn_code) return res.status(400).json({ error: 'HSN/SAC code is required.' });
    const pool = getPool();
    // Upsert HSN record if not existing
    let hsnId = null;
    if (b.hsn_code) {
      const [h] = await pool.query('SELECT id FROM hsn_sac_codes WHERE code=?', [b.hsn_code]);
      if (h.length) hsnId = h[0].id;
      else {
        const rate = Number(b.gst_rate) || 0;
        const [hs] = await pool.query(
          `INSERT INTO hsn_sac_codes (code,description,type,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate)
           VALUES (?,?,'HSN',?,?,?,?,?)`,
          [b.hsn_code, b.name, rate, rate/2, rate/2, rate, Number(b.cess_rate) || 0]
        );
        hsnId = hs.insertId;
      }
    }
    const [r] = await pool.query(
      `INSERT INTO products
       (sku,barcode,name,description,category_id,hsn_id,hsn_code,gst_rate,cess_rate,unit,
        selling_price,wholesale_price,distributor_price,purchase_price,mrp,min_stock,track_batch,track_serial,weight_kg,is_service,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        b.sku || null, b.barcode || null, b.name, b.description || null, b.category_id || null, hsnId,
        b.hsn_code, Number(b.gst_rate) || 0, b.cess_rate === undefined ? null : Number(b.cess_rate) || 0, b.unit || 'PCS',
        Number(b.selling_price) || 0, b.wholesale_price || null, b.distributor_price || null, Number(b.purchase_price) || 0, b.mrp || null,
        b.min_stock || null, b.track_batch ? 1 : 0, b.track_serial ? 1 : 0, b.weight_kg || null, b.is_service ? 1 : 0, b.is_active === undefined ? 1 : b.is_active ? 1 : 0,
      ]
    );
    // Opening stock movement (with batch lot when provided)
    const opening = Number(b.opening_stock) || 0;
    if (opening > 0 && !b.is_service) {
      let batchId = null;
      if (b.batch_no || b.track_batch) {
        batchId = await lots.getOrCreateLot(pool, {
          product_id: r.insertId, batch_no: b.batch_no || `${r.insertId}-OB`,
          expiry_date: b.expiry_date, mfg_date: b.mfg_date, created_by: req.user.id,
        });
      }
      await pool.query(
        `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,note,created_by)
         VALUES (?,'IN',?,?,?,?,'opening','Opening stock',?)`,
        [r.insertId, opening, Number(b.purchase_price) || 0, batchId, b.serial_numbers || null, req.user.id]
      );
    }
    res.status(201).json({ id: r.insertId, message: 'Product created.', hsnId });
    await audit(req, 'CREATE', 'product', r.insertId, { name: b.name, sku: b.sku || null });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const pool = getPool();
    const allowed = ['sku','barcode','name','description','category_id','hsn_id','hsn_code','gst_rate','cess_rate','unit','selling_price','wholesale_price','distributor_price','purchase_price','mrp','min_stock','track_batch','track_serial','weight_kg','is_service','is_active'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (b[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(b[f]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(id);
    await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id=?`, params);
    await audit(req, 'UPDATE', 'product', id, { fields: Object.fromEntries(allowed.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) });
    res.json({ message: 'Product updated.' });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    // Listed product or one referenced by documents cannot be hard-deleted
    // (Rule 46 / auditing): deactivate instead via is_active=0.
    const [[ref]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM invoice_items WHERE product_id=?) +
        (SELECT COUNT(*) FROM purchase_bill_items WHERE product_id=?) +
        (SELECT COUNT(*) FROM stock_movements WHERE product_id=?) AS refs`,
      [id, id, id]
    );
    const refs = Number(ref && ref.refs) || 0;
    const [p] = await pool.query('SELECT name FROM products WHERE id=?', [id]);
    if (refs > 0) {
      await pool.query('UPDATE products SET is_active=0 WHERE id=?', [id]);
      await audit(req, 'DEACTIVATE', 'product', id, { name: p[0]?.name || null, refs });
      return res.json({ message: 'Product has transaction history - deactivated instead of deleted.', deactivated: true });
    }
    const [r] = await pool.query('DELETE FROM products WHERE id=?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Product not found.' });
    await audit(req, 'DELETE', 'product', id, { name: p[0]?.name || null });
    res.json({ message: 'Product deleted.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, get, create, update, remove, listCategories, createCategory };