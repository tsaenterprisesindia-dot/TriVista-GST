const { round2 } = require('./gst');

/** Financial-year date range for a given date (YY-MM-DD). */
function fyRange(dateStr) {
  const d = new Date(String(dateStr || new Date().toISOString().slice(0, 10)).slice(0, 10) + 'T00:00:00');
  if (isNaN(d.getTime())) d = new Date();
  const y = d.getFullYear();
  const start = d.getMonth() + 1 >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

/**
 * TCS u/s 206C(1H): 0.1% (default 0.10) of sale consideration exceeding the
 * threshold (default ₹50L) in a FY, on goods sales by a registered seller.
 * Applied per invoice on the portion beyond the cumulative threshold.
 */
async function computeTcs(pool, customerId, invoiceDate, thisTaxable, excludeInvoiceId, settings) {
  if (!Number(settings.apply_tcs)) return 0;
  const { from, to } = fyRange(invoiceDate);
  const [rows] = await pool.query(
    `SELECT IFNULL(SUM(subtotal - discount),0) AS v FROM invoices
     WHERE customer_id=? AND status NOT IN ('CANCELLED') AND invoice_date BETWEEN ? AND ? AND id<>?`,
    [customerId, from, to, excludeInvoiceId || 0]
  );
  const prev = Number(rows[0].v) || 0;
  const threshold = Number(settings.tcs_threshold) || 0;
  const excess = Math.max(0, prev + thisTaxable - threshold);
  const applicable = Math.min(thisTaxable, excess);
  if (applicable <= 0) return 0;
  let rate = Number(settings.tcs_rate) || 0.1;
  const [panRows] = await pool.query('SELECT pan FROM customers WHERE id=?', [customerId]);
  if (!panRows.length || !panRows[0].pan) rate = 1.0; // 206CC: higher rate when PAN absent
  return round2((applicable * rate) / 100);
}

/**
 * TDS u/s 194Q: 0.1% (default 0.10) of purchase value exceeding the
 * threshold (default ₹50L) in a FY, deducted by a buyer on goods purchases.
 */
async function computeTds(pool, vendorId, billDate, thisTaxable, excludeBillId, settings) {
  if (!Number(settings.apply_tds)) return 0;
  const { from, to } = fyRange(billDate);
  const [rows] = await pool.query(
    `SELECT IFNULL(SUM(subtotal - discount),0) AS v FROM purchase_bills
     WHERE vendor_id=? AND status NOT IN ('CANCELLED') AND bill_date BETWEEN ? AND ? AND id<>?`,
    [vendorId, from, to, excludeBillId || 0]
  );
  const prev = Number(rows[0].v) || 0;
  const threshold = Number(settings.tds_threshold) || 0;
  const excess = Math.max(0, prev + thisTaxable - threshold);
  const applicable = Math.min(thisTaxable, excess);
  if (applicable <= 0) return 0;
  let rate = Number(settings.tds_rate) || 0.1;
  const [panRows] = await pool.query('SELECT pan FROM vendors WHERE id=?', [vendorId]);
  if (!panRows[0].pan) rate = 5.0; // 206AA: higher of rate-in-force or 5% when PAN absent
  return round2((applicable * rate) / 100);
}

module.exports = { computeTcs, computeTds, fyRange };