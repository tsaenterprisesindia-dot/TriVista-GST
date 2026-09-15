const { pad, fyKey } = require('./helpers');

/**
 * Allocate the next gap-less invoice number for a financial year,
 * scoped per BRANCH (branch_id, fy, series_type), using a row-level lock
 * on invoice_series so concurrent requests never issue the same number
 * (Rule 46 fresh sequential series per FY per branch).
 * A branch's series starts at its own invoice_start_number.
 * Must be called inside an open transaction (conn).
 *
 * Returns e.g. "BR1-2627-0000003".
 */
async function allocateInvoiceNumber(conn, branch, dateStr) {
  const fy = fyKey(dateStr);
  const branchId = branch && branch.id != null ? branch.id : null;
  const start = Number(branch && branch.invoice_start_number) || 0;
  await conn.query(
    `INSERT INTO invoice_series (branch_id, fy, series_type, last_number) VALUES (?,?,'SALES',?)
     ON DUPLICATE KEY UPDATE last_number = last_number`,
    [branchId, fy, start]
  );
  const [rows] = await conn.query(
    `SELECT last_number FROM invoice_series WHERE branch_id=? AND fy=? AND series_type='SALES' FOR UPDATE`,
    [branchId, fy]
  );
  const seq = Number(rows[0].last_number) + 1;
  await conn.query(
    `UPDATE invoice_series SET last_number=? WHERE branch_id=? AND fy=? AND series_type='SALES'`,
    [seq, branchId, fy]
  );
  return `${(branch && branch.invoice_prefix) || 'INV'}-${fy}-${pad(seq, 7)}`;
}

/**
 * Allocate the next gap-less RETURN number (RTN-<fy>-<seq>) for the in-house
 * returns/refunds workflow. Uses its own series_type so it never collides with
 * sales invoices. Must be called inside an open transaction (conn).
 */
async function allocateReturnNumber(conn, branch, dateStr) {
  const fy = fyKey(dateStr);
  const branchId = branch && branch.id != null ? branch.id : null;
  const start = Number(branch && branch.invoice_start_number) || 0;
  await conn.query(
    `INSERT INTO invoice_series (branch_id, fy, series_type, last_number) VALUES (?,?,'RETURN',?)
     ON DUPLICATE KEY UPDATE last_number = last_number`,
    [branchId, fy, start]
  );
  const [rows] = await conn.query(
    `SELECT last_number FROM invoice_series WHERE branch_id=? AND fy=? AND series_type='RETURN' FOR UPDATE`,
    [branchId, fy]
  );
  const seq = Number(rows[0].last_number) + 1;
  await conn.query(
    `UPDATE invoice_series SET last_number=? WHERE branch_id=? AND fy=? AND series_type='RETURN'`,
    [seq, branchId, fy]
  );
  return `RTN-${fy}-${pad(seq, 7)}`;
}

module.exports = { allocateInvoiceNumber, allocateReturnNumber };