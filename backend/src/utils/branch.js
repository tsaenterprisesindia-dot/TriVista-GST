const { isValidGstin } = require('./gst');

const PROFILE_FIELDS = [
  'company_name', 'gstin', 'pan', 'tan', 'address_line1', 'address_line2',
  'city', 'state', 'state_code', 'pincode', 'phone', 'email', 'invoice_prefix',
];

/**
 * Resolve the currently ACTIVE branch (the one whose printable profile and
 * billing series invoices use). Falls back to the head office / first branch,
 * then to the single company_settings row when no branch has been activated.
 *
 * `conn` - pool or transaction connection.
 * Returns a branch row (with `.id`), or `null` when nothing exists.
 */
async function getActiveBranch(conn) {
  const [[cs]] = await conn.query(
    `SELECT cs.active_branch_id, cs.invoice_prefix, cs.invoice_start_number, cs.state_code
     FROM company_settings cs ORDER BY cs.id LIMIT 1`
  );
  const [[b]] = await conn.query(
    `SELECT * FROM branches WHERE id=? AND is_active=1 LIMIT 1`,
    [cs && cs.active_branch_id ? cs.active_branch_id : -1]
  );
  if (b) return b;
  const [[fb]] = await conn.query(
    `SELECT * FROM branches WHERE is_active=1 ORDER BY is_head_office DESC, id LIMIT 1`
  );
  if (fb) return fb;
  if (!cs) return null;
  return {
    id: null,
    branch_name: 'Head Office',
    company_name: null,
    gstin: null,
    invoice_prefix: cs.invoice_prefix || 'INV',
    invoice_start_number: cs.invoice_start_number || 0,
    state_code: cs.state_code || '',
    address_line1: null,
    address_line2: null,
    city: null,
    state: null,
    pincode: null,
  };
}

/**
 * Copy a branch's printable profile into company_settings so every screen that
 * reads company_settings automatically reflects the active branch. Only touches
 * PROFILE_FIELDS - settings (TDS/TCS, UPI, e-invoice, prefixes of other types) stay.
 */
async function syncBranchProfile(conn, branch) {
  if (!branch) return;
  const [[cs]] = await conn.query('SELECT id FROM company_settings ORDER BY id LIMIT 1');
  if (!cs) return;
  const sets = [];
  const params = [];
  for (const f of PROFILE_FIELDS) {
    sets.push(`${f}=?`);
    let v = branch[f] == null ? null : branch[f];
    if (f === 'company_name' && !v) v = branch.branch_name || null;
    params.push(v);
  }
  sets.push('active_branch_id=?');
  params.push(branch.id);
  params.push(cs.id);
  await conn.query(`UPDATE company_settings SET ${sets.join(', ')} WHERE id=?`, params);
}

/**
 * Validation shared by create/update - returns an error string or null.
 */
function validateBranch(b) {
  if (!b || !String(b.branch_name || '').trim()) return 'Branch name is required.';
  if (b.gstin && !isValidGstin(b.gstin)) return 'Invalid GSTIN format.';
  return null;
}

module.exports = { getActiveBranch, syncBranchProfile, validateBranch, PROFILE_FIELDS };