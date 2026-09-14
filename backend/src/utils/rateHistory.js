/**
 * Effective-dated GST rate store.
 *
 * Rates are never hard-coded in the tax engine. They live on the HSN/SAC master
 * (current rate) plus hsn_sac_rate_history (each statutory regime, dated).
 * Invoice lines snapshot their rate at creation time, so past documents are
 * never rewound when a rate changes.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const dayShift = (dateStr, delta) => {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Superseded rates whose start date is unknown get this safe lower bound.
// Predates any GST-era invoice, so [BACKFILL_FROM, effective_to-1d] always
// covers the pre-change period.
const BACKFILL_FROM = '2020-01-01';

/**
 * Resolve the GST/cess rate in force for an HSN/SAC code on a given date.
 * Resolves against hsn_sac_rate_history first; falls back to the master table
 * (covers installs before history was tracked, and codes never changed).
 * @param {object} db - a connection or pool exposing .query(sql, params)
 * @param {object} opts
 * @param {string} [opts.hsnCode]
 * @param {string} opts.date - YYYY-MM-DD of the supply
 * @param {number} [opts.fallbackRate] - rate supplied by the caller (manual line)
 * @returns {{ gst_rate: number, cess_rate: number, resolved: boolean, from_history: boolean }}
 */
async function resolveRateForDate(db, { hsnCode, date, fallbackRate = 0 }) {
  if (!hsnCode) {
    return { gst_rate: Number(fallbackRate) || 0, cess_rate: 0, resolved: false, from_history: false };
  }
  const [his] = await db.query(
    `SELECT h.gst_rate, h.cess_rate
       FROM hsn_sac_rate_history h
       JOIN hsn_sac_codes c ON c.id = h.hsn_sac_id
      WHERE c.code = ? AND h.effective_from <= ? AND (h.effective_to IS NULL OR h.effective_to >= ?)
      ORDER BY h.effective_from DESC
      LIMIT 1`,
    [hsnCode, date, date]
  );
  if (his.length) {
    return { gst_rate: Number(his[0].gst_rate) || 0, cess_rate: Number(his[0].cess_rate) || 0, resolved: true, from_history: true };
  }
  const [cur] = await db.query(
    'SELECT gst_rate, cess_rate FROM hsn_sac_codes WHERE code = ? LIMIT 1',
    [hsnCode]
  );
  if (cur.length) {
    return { gst_rate: Number(cur[0].gst_rate) || 0, cess_rate: Number(cur[0].cess_rate) || 0, resolved: true, from_history: false };
  }
  return { gst_rate: Number(fallbackRate) || 0, cess_rate: 0, resolved: false, from_history: false };
}

/**
 * Record a dated rate change for an HSN/SAC code and update the master row.
 *
 * Keeps the history contiguous:
 *  - closes any open-ended regime the day before the new effective date,
 *  - backfills the superseded rate (from BACKFILL_FROM) when this is the first
 *    recorded change, so pre-change dates still resolve correctly,
 *  - inserts the new regime as the open-ended row,
 *  - updates hsn_sac_codes to the new current rate.
 *
 * @param {object} db - connection or pool exposing .query(sql, params)
 * @param {object} opts
 * @param {string} opts.code - HSN/SAC code
 * @param {string} opts.effectiveFrom - YYYY-MM-DD the new rate applies from
 * @param {number} opts.gstRate - new total GST %
 * @param {number} [opts.cessRate]
 * @param {string} [opts.source] - e.g. 'Notification 01/2025' or 'CSV import'
 * @param {string} [opts.notes]
 * @param {number} [opts.createdBy]
 * @returns {Promise<{ hsnId: number, historyId: number, master: object, backfilled: boolean }>}
 */
async function applyRateChange(db, { code, effectiveFrom, gstRate, cessRate, source = null, notes = null, createdBy = null }) {
  const [rows] = await db.query('SELECT * FROM hsn_sac_codes WHERE code = ? LIMIT 1', [code]);
  if (!rows.length) {
    const err = new Error(`HSN/SAC code "${code}" not found.`);
    err.status = 404;
    throw err;
  }
  const master = rows[0];
  const newFrom = String(effectiveFrom || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newFrom)) {
    const err = new Error('effective_from (YYYY-MM-DD) is required.');
    err.status = 400;
    throw err;
  }
  const newRate = round2(Number(gstRate));
  if (Number.isNaN(newRate) || newRate < 0 || newRate > 100) {
    const err = new Error('gst_rate must be between 0 and 100.');
    err.status = 400;
    throw err;
  }
  const newCess = cessRate == null ? round2(Number(master.cess_rate) || 0) : round2(Number(cessRate));

  const closedOn = `DATE_SUB(?, INTERVAL 1 DAY)`;
  // Close any open-ended regime before the new date.
  await db.query(
    `UPDATE hsn_sac_rate_history SET effective_to = ${closedOn}
      WHERE hsn_sac_id = ? AND effective_to IS NULL`,
    [newFrom, master.id]
  );

  // First recorded change: backfill the superseded rate so earlier dates resolve.
  let backfilled = false;
  const [hasHistory] = await db.query(
    'SELECT COUNT(*) AS n FROM hsn_sac_rate_history WHERE hsn_sac_id = ?',
    [master.id]
  );
  if (Number(hasHistory[0].n) === 0) {
    await db.query(
      `INSERT INTO hsn_sac_rate_history
       (hsn_sac_id,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate,effective_from,effective_to,source,notes,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        master.id, Number(master.gst_rate) || 0, Number(master.cgst_rate) || 0,
        Number(master.sgst_rate) || 0, Number(master.igst_rate) || 0,
        Number(master.cess_rate) || 0, BACKFILL_FROM, dayShift(newFrom, -1),
        'Existing rate (backfilled)', 'Rate in force before the first recorded change', createdBy,
      ]
    );
    backfilled = true;
  }

  const [ins] = await db.query(
    `INSERT INTO hsn_sac_rate_history
     (hsn_sac_id,gst_rate,cgst_rate,sgst_rate,igst_rate,cess_rate,effective_from,effective_to,source,notes,created_by)
     VALUES (?,?,?,?,?,?,?,NULL,?,?,?)`,
    [master.id, newRate, round2(newRate / 2), round2(newRate / 2), newRate, newCess, newFrom, source, notes, createdBy]
  );

  await db.query(
    `UPDATE hsn_sac_codes SET gst_rate=?, cgst_rate=?, sgst_rate=?, igst_rate=?, cess_rate=? WHERE id=?`,
    [newRate, round2(newRate / 2), round2(newRate / 2), newRate, newCess, master.id]
  );

  return { hsnId: master.id, historyId: ins.insertId, backfilled };
}

module.exports = { resolveRateForDate, applyRateChange, BACKFILL_FROM };