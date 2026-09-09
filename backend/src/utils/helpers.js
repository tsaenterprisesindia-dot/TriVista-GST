/**
 * Generic + ERP compatibility helpers.
 */

function toRupee(n) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function toNumber(str) {
  const n = parseFloat(String(str).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function pad(n, width) {
  return String(n).padStart(width, '0');
}

/**
 * Build the next invoice number from prefix + sequence.
 * E.g. prefix "INV", seq 1042 -> "INV-1042-2026" style or "INV1042".
 * Keeps it simple: "INV-0001042".
 */
function buildInvoiceNumber(prefix, sequence) {
  return `${prefix}-${pad(sequence, 7)}`;
}

/**
 * Financial year key from a date (YYYY-MM-DD).
 * FY 2025-26 -> "2526" (Apr 2025 .. Mar 2026). Unknown/blank -> current FY.
 */
function fyKey(dateStr) {
  const d = dateStr ? new Date(String(dateStr).slice(0, 10) + 'T00:00:00') : new Date();
  if (isNaN(d.getTime())) d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1..12
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

/** Today's date as YYYY-MM-DD in the application's local timezone. */
function localDateStr(d) {
  const x = d ? new Date(d) : new Date();
  if (isNaN(x.getTime())) x = new Date();
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

module.exports = { toRupee, toNumber, pad, buildInvoiceNumber, fyKey, localDateStr };