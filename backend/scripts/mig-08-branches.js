// mig-08-branches.js
// Unit/Branch Management wiring:
//   1. branches.invoice_start_number       -> per-branch starting invoice number
//   2. company_settings.active_branch_id   -> the currently active branch (whose profile is printed)
//   3. invoice_series.branch_id            -> per-branch billing series (branch_id, fy, series_type)
// Backfills: creates a head-office branch from company_settings if none exists,
// sets active_branch_id, and re-homes existing invoice_series rows to that branch.
// Idempotent; prints MIG OK.
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'triveni_gst_erp',
  multipleStatements: true,
};

(async () => {
  const c = await mysql.createConnection(DB);

  const col = async (table, name) =>
    (await c.query(`SHOW COLUMNS FROM ${table} LIKE '${name}'`))[0].length;

  // 1. Per-branch invoice start number
  if (!(await col('branches', 'invoice_start_number'))) {
    await c.query('ALTER TABLE branches ADD COLUMN invoice_start_number INT UNSIGNED NOT NULL DEFAULT 0 AFTER invoice_prefix');
    console.log('added branches.invoice_start_number');
  } else {
    console.log('branches.invoice_start_number already present');
  }

  // 2. Active branch marker on company_settings
  if (!(await col('company_settings', 'active_branch_id'))) {
    await c.query('ALTER TABLE company_settings ADD COLUMN active_branch_id INT UNSIGNED DEFAULT NULL AFTER round_off');
    console.log('added company_settings.active_branch_id');
  } else {
    console.log('company_settings.active_branch_id already present');
  }

  // 3. Ensure a head-office branch exists (from company_settings if none)
  const [[cs]] = await c.query('SELECT id, company_name, gstin, pan, tan, address_line1, city, state, state_code, pincode, phone, email, invoice_prefix FROM company_settings ORDER BY id LIMIT 1');
  const [[branchCount]] = await c.query('SELECT COUNT(*) AS n FROM branches');
  let headOfficeId = null;
  if (Number(branchCount.n) === 0) {
    const [ins] = await c.query(
      `INSERT INTO branches (branch_name, company_name, gstin, pan, address_line1, city, state, state_code, pincode, phone, email, invoice_prefix, invoice_start_number, is_head_office)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      [cs ? `${cs.company_name} - Head Office` : 'Head Office', cs?.company_name || null, cs?.gstin || null, cs?.pan || null,
       cs?.address_line1 || null, cs?.city || null, cs?.state || null, cs?.state_code || null, cs?.pincode || null,
       cs?.phone || null, cs?.email || null, cs?.invoice_prefix || 'INV', 0]
    );
    headOfficeId = ins.insertId;
    console.log('created head-office branch');
  } else {
    const [[ho]] = await c.query('SELECT id FROM branches WHERE is_head_office=1 OR is_active=1 ORDER BY is_head_office DESC, id LIMIT 1');
    headOfficeId = ho.id;
  }

  // 4. Backfill active_branch_id
  if ((await col('company_settings', 'active_branch_id')) && (cs?.active_branch_id == null)) {
    await c.query('UPDATE company_settings SET active_branch_id=? WHERE id=?', [headOfficeId, cs.id]);
    console.log(`set company_settings.active_branch_id=${headOfficeId}`);
  }

  // 5. Re-home invoice_series to the active branch and scope by branch_id
  if (!(await col('invoice_series', 'branch_id'))) {
    await c.query('ALTER TABLE invoice_series ADD COLUMN branch_id INT UNSIGNED NOT NULL DEFAULT 0 AFTER fy');
    await c.query('UPDATE invoice_series SET branch_id=? WHERE branch_id=0', [headOfficeId]);
    await c.query('ALTER TABLE invoice_series DROP PRIMARY KEY, ADD PRIMARY KEY (branch_id, fy, series_type)');
    console.log('invoice_series now keyed per branch+FY');
  } else {
    console.log('invoice_series.branch_id already present');
  }

  const [[cfg]] = await c.query('SELECT cs.company_name, cs.invoice_prefix, b.branch_name, b.gstin FROM company_settings cs JOIN branches b ON b.id=cs.active_branch_id ORDER BY cs.id LIMIT 1');
  console.log('active branch ->', cfg);
  console.log('MIG OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });