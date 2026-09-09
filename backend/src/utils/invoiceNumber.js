const { pad, fyKey } = require('./helpers');

/**
 * Allocate the next gap-less invoice number for a financial year,
 * using a row-level lock on invoice_series so concurrent requests
 * never issue the same number (Rule 46 fresh sequential series per FY).
 * Must be called inside an open transaction (conn).
 *
 * Returns e.g. "INV-2526-0000001" for FY 2025-26.
 */
async function allocateInvoiceNumber(conn, company, dateStr) {
  const fy = fyKey(dateStr);
  await conn.query(
    `INSERT INTO invoice_series (fy, series_type, last_number) VALUES (?,'SALES',0)
     ON DUPLICATE KEY UPDATE last_number = last_number`,
    [fy]
  );
  const [rows] = await conn.query(
    `SELECT last_number FROM invoice_series WHERE fy=? AND series_type='SALES' FOR UPDATE`,
    [fy]
  );
  const seq = Number(rows[0].last_number) + 1;
  await conn.query(
    `UPDATE invoice_series SET last_number=? WHERE fy=? AND series_type='SALES'`,
    [seq, fy]
  );
  return `${company.invoice_prefix || 'INV'}-${fy}-${pad(seq, 7)}`;
}

module.exports = { allocateInvoiceNumber };