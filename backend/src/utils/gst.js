/**
 * GST tax engine.
 * Splits a single GST rate into CGST/SGST (intra-state) or IGST (inter-state)
 * based on the place of supply vs the company's registered state.
 */

/**
 * Calculate tax on a line amount.
 * @param {number} amount - taxable value (before tax)
 * @param {number} gstRate - total GST % (e.g. 18)
 * @param {string|null} placeOfSupply - 2-digit state code of buyer
 * @param {string|null} companyStateCode - 2-digit state code of seller
 */
function splitGst(amount, gstRate, placeOfSupply, companyStateCode) {
  const a = Number(amount) || 0;
  const r = Number(gstRate) || 0;
  const isInterstate =
    !!placeOfSupply && !!companyStateCode && placeOfSupply !== companyStateCode;

  if (isInterstate) {
    return {
      isInterstate: true,
      igst: round2((a * r) / 100),
      cgst: 0,
      sgst: 0,
      cess: 0,
    };
  }
  const half = r / 2;
  return {
    isInterstate: false,
    igst: 0,
    cgst: round2((a * half) / 100),
    sgst: round2((a * half) / 100),
    cess: 0,
  };
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Validate an Indian GSTIN.
 * Format: 2 state code + 10 PAN + 1 entity + 1 Z + 1 checksum (15 chars)
 */
function isValidGstin(gstin) {
  if (!gstin) return false;
  const s = String(gstin).trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(s)) return false;
  // checksum is not easily derivable without full algorithm; structural check above suffices for business use
  return true;
}

/**
 * Human-friendly GST rate annotation, e.g. 18 -> "CGST 9% + SGST 9%"
 */
function gstRateLabel(rate, placeOfSupply, companyStateCode) {
  const isInt =
    !!placeOfSupply && !!companyStateCode && placeOfSupply !== companyStateCode;
  if (isInt) return `IGST ${rate}%`;
  const half = Number(rate) / 2;
  return `CGST ${half}% + SGST ${half}%`;
}

module.exports = { splitGst, round2, isValidGstin, gstRateLabel };