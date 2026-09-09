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

module.exports = { toRupee, toNumber, pad, buildInvoiceNumber };