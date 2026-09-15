const { getPool } = require('../db');
const { audit } = require('./audit');

/**
 * Batch / expiry / serial tracking helpers.
 *
 * Stock stays reactive (computed from stock_movements). `lot_batches` is the
 * master record for a batch (product + batch_no unique). Movements carry an
 * optional batch_id and, for serialised goods, a comma-separated list of serial
 * numbers. Per-batch availability and "remaining serials" are always derived
 * from the movements, so nothing is ever double counted.
 */

const onHandQty = `IFNULL(SUM(CASE WHEN sm.type='IN' THEN sm.quantity WHEN sm.type='OUT' THEN -sm.quantity ELSE sm.quantity END),0)`;

function splitSerials(str) {
  if (!str) return [];
  return String(str)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function onHand(conn, productId) {
  const [rows] = await conn.query(
    `SELECT ${onHandQty} AS stock FROM stock_movements sm WHERE sm.product_id=?`,
    [productId]
  );
  return Number(rows[0].stock) || 0;
}

/** Ensure the lot master row exists for (product, batch_no); returns its id. */
async function getOrCreateLot(conn, { product_id, batch_no, mfg_date, expiry_date, created_by }) {
  if (!product_id || !batch_no) throw Object.assign(new Error('batch_no is required for batch-tracked stock.'), { status: 400, expose: true });
  const [rows] = await conn.query(
    `SELECT id, mfg_date, expiry_date FROM lot_batches WHERE product_id=? AND batch_no=?`,
    [product_id, String(batch_no)]
  );
  if (rows.length) {
    // Backfill missing dates from a later receiving of the same batch.
    const upd = {};
    if (!rows[0].mfg_date && mfg_date) upd.mfg_date = mfg_date;
    if (!rows[0].expiry_date && expiry_date) upd.expiry_date = expiry_date;
    if (Object.keys(upd).length) {
      await conn.query('UPDATE lot_batches SET ? WHERE id=?', [upd, rows[0].id]);
    }
    return rows[0].id;
  }
  const [r] = await conn.query(
    `INSERT INTO lot_batches (product_id,batch_no,mfg_date,expiry_date,created_by)
     VALUES (?,?,?,?,?)`,
    [product_id, String(batch_no), mfg_date || null, expiry_date || null, created_by || null]
  );
  return r.insertId;
}

/** Serial numbers currently available for a product/batch (IN list minus OUT list). */
async function availableSerials(conn, productId, batchId) {
  const [rows] = await conn.query(
    `SELECT serial_numbers FROM stock_movements
     WHERE product_id=? AND batch_id=? AND serial_numbers IS NOT NULL AND serial_numbers<>''`,
    [productId, batchId]
  );
  const seen = new Map();
  for (const r of rows) {
    for (const s of splitSerials(r.serial_numbers)) seen.set(s, (seen.get(s) || 0) + 1);
  }
  const out = [];
  const byBatch = await conn.query(
    `SELECT sm.serial_numbers FROM stock_movements sm
     WHERE sm.product_id=? AND sm.batch_id=? AND sm.type='OUT' AND sm.serial_numbers IS NOT NULL AND sm.serial_numbers<>''`,
    [productId, batchId]
  );
  const issued = new Map();
  for (const r of byBatch[0]) {
    for (const s of splitSerials(r.serial_numbers)) issued.set(s, (issued.get(s) || 0) + 1);
  }
  for (const [s, n] of seen) {
    const used = issued.get(s) || 0;
    for (let i = 0; i < n - used; i++) out.push(s);
  }
  return out;
}

/**
 * Issue stock for a sale/OUT. For batch-tracked products locks FIFO (earliest
 * expiry first) and splits the OUT across lots; for serialised products it also
 * assigns the earliest available serials. Untracked products use a single OUT.
 * Returns the array of movement rows inserted.
 */
async function issueForSale(conn, { product_id, qty, note, created_by, reference_type, reference_id }) {
  const need = Number(qty);
  const [prods] = await conn.query('SELECT is_service, track_batch, track_serial FROM products WHERE id=?', [product_id]);
  const p = prods[0] || {};
  const total = await onHand(conn, product_id);
  if (total < need) throw Object.assign(new Error(`Insufficient stock. Only ${total} available.`), { status: 400, expose: true });

  const inserted = [];
  if (!p.track_batch) {
    const [r] = await conn.query(
      `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
       VALUES (?,?,?,NULL,NULL,NULL,?,?,?,?)`,
      [product_id, 'OUT', need, reference_type || 'sale', reference_id || null, note || null, created_by || null]
    );
    inserted.push({ id: r.insertId });
    return inserted;
  }

  let remaining = need;
  const [lots] = await conn.query(
    `SELECT l.id, l.batch_no, l.expiry_date,
            ${onHandQty} AS available
     FROM lot_batches l
     JOIN stock_movements sm ON sm.batch_id=l.id
     WHERE l.product_id=?
     GROUP BY l.id, l.batch_no, l.expiry_date
     HAVING available > 0
     ORDER BY IFNULL(l.expiry_date,'9999-12-31') ASC, l.id ASC`,
    [product_id]
  );
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.available), remaining);
    let serials = null;
    if (p.track_serial) {
      const poolSerials = await availableSerials(conn, product_id, lot.id);
      if (poolSerials.length < take) {
        throw Object.assign(new Error(`Only ${poolSerials.length} serialised unit(s) available in batch ${lot.batch_no} (need ${take}).`), { status: 400, expose: true });
      }
      serials = poolSerials.slice(0, take).join(',');
    }
    const [r] = await conn.query(
      `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
       VALUES (?,'OUT',?,NULL,?,?,?,?,?,?)`,
      [product_id, take, lot.id, serials, reference_type || 'sale', reference_id || null, note || null, created_by || null]
    );
    inserted.push({ id: r.insertId, lotId: lot.id, qty: take, serials });
    remaining -= take;
  }
  if (remaining > 0) {
    throw Object.assign(new Error(`Insufficient batch-tracked stock. ${remaining} more unit(s) required.`), { status: 400, expose: true });
  }
  return inserted;
}

/** Record stock (IN/OUT/ADJUST) with optional batch + serials. */
async function recordIn(conn, { product_id, qty, unit_cost, note, created_by, reference_type, reference_id, track, type = 'IN' }) {
  const trackBatch = Number(track.track_batch) === 1;
  const trackSerial = Number(track.track_serial) === 1 && trackBatch;
  const batchId = track.batch_id || null;
  let serials = track.serial_numbers ? splitSerials(track.serial_numbers).join(',') : null;
  const [r] = await conn.query(
    `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [product_id, type, qty, unit_cost || null, batchId, serials, reference_type || 'purchase', reference_id || null, note || null, created_by || null]
  );
  if (trackSerial && serials) {
    const n = splitSerials(serials).length;
    if (n !== Number(qty)) {
      throw Object.assign(new Error(`Serial list has ${n} entries but quantity is ${qty}. Provide one serial per unit.`), { status: 400, expose: true });
    }
  }
  return r.insertId;
}

/**
 * Mirror stock on invoice cancellation: every OUT the sale wrote becomes an IN
 * (same lot + serials) and every IN written by a credit note becomes an OUT,
 * keeping batch/expiry intact.
 */
async function restoreForCancelledInvoice(conn, { reference_type, reference_id, created_by, note }) {
  const [outs] = await conn.query(
    `SELECT product_id, quantity, batch_id, serial_numbers, type FROM stock_movements
     WHERE reference_id=? AND type IN ('OUT','IN')
       AND (reference_type IN ('invoice','pos','credit_note') OR reference_type=?)`,
    [reference_id, reference_type]
  );
  const mirrored = { OUT: 'IN', IN: 'OUT' };
  for (const o of outs) {
    await conn.query(
      `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
       VALUES (?,'${mirrored[o.type]}',?,NULL,?,?,?,?,?,?)`,
      [o.product_id, o.quantity, o.batch_id, o.serial_numbers, 'cancel', reference_id, note || 'Cancelled invoice restore', created_by || null]
    );
  }
  return outs.length;
}

/**
 * Restock the returned portion of an invoice (partial returns). Mirrors the
 * original OUT movements back as IN movements (same lot + serials where the
 * returned quantity fully covers a movement), scoped to the returned lines.
 * Returns the number of movements written.
 */
async function restoreForReturn(conn, { invoice_id, lines, reference_type = 'return', reference_id, created_by, note }) {
  const seen = [];
  const want = new Map();
  for (const l of lines) {
    const key = Number(l.product_id);
    want.set(key, (want.get(key) || 0) + Number(l.qty));
    if (!l.qty) continue;
  }
  if (!want.size) return 0;

  const [outs] = await conn.query(
    `SELECT id, product_id, type, quantity, batch_id, serial_numbers
     FROM stock_movements
     WHERE reference_id=? AND type='OUT'
       AND reference_type IN ('invoice','pos')
     ORDER BY id DESC`,
    [invoice_id]
  );

  const pending = new Map(want);
  for (const o of outs) {
    const key = Number(o.product_id);
    let need = pending.get(key);
    if (!need || need <= 0) continue;
    const take = Math.min(Number(o.quantity), need);
    let serials = null;
    if (take === Number(o.quantity) && o.serial_numbers) serials = o.serial_numbers;
    await conn.query(
      `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
       VALUES (?,'IN',?,NULL,?,?,?,?,?,?)`,
      [key, take, o.batch_id, serials, reference_type, reference_id || null, note || `Return restock`, created_by || null]
    );
    seen.push(o.id);
    pending.set(key, Math.round((need - take) * 100) / 100);
    if (pending.get(key) <= 0) pending.delete(key);
  }
  return seen.length;
}

/**
 * Fallback (legacy) restore for invoices that predate movement referencing:
 * adds one IN per invoice line, batch-less.
 */
async function restoreLegacy(conn, { invoice_id, created_by }) {
  const [items] = await conn.query('SELECT product_id, quantity FROM invoice_items WHERE invoice_id=?', [invoice_id]);
  for (const it of items) {
    if (it.product_id) {
      await conn.query(
        `INSERT INTO stock_movements (product_id,type,quantity,unit_cost,batch_id,serial_numbers,reference_type,reference_id,note,created_by)
         VALUES (?,'IN',?,NULL,NULL,NULL,'cancel',?,?,?)`,
        [it.product_id, it.quantity, invoice_id, 'Cancelled invoice restore', created_by || null]
      );
    }
  }
  return items.length;
}

async function auditMovement(req, movementId, payload) {
  await audit(req, 'STOCK', 'stock', movementId, payload);
}

module.exports = {
  splitSerials,
  onHand,
  getOrCreateLot,
  availableSerials,
  issueForSale,
  recordIn,
  restoreForCancelledInvoice,
  restoreForReturn,
  restoreLegacy,
  auditMovement,
};
