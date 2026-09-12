// mig-09-parties.js
// Customer & Supplier Management - registration classification + per-party tax controls.
//
// customers: registration_category, tax_exempt, tds_rate, tcs_rate, tds_threshold, tcs_threshold
// vendors:   registration_category, tax_exempt, rcm_default, tds_rate, tds_threshold
//
// Backfills registration_category from GSTIN (registered/unregistered). Idempotent; prints MIG OK.
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

  const add = async (table, col, ddl) => {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
    if (!cols.length) {
      await c.query(ddl);
      console.log(`added ${table}.${col}`);
    } else {
      console.log(`${table}.${col} already present`);
    }
  };

  // ---- customers ----
  await add('customers', 'registration_category', "ALTER TABLE customers ADD COLUMN registration_category VARCHAR(20) DEFAULT NULL AFTER gstin");
  await add('customers', 'tax_exempt', "ALTER TABLE customers ADD COLUMN tax_exempt TINYINT(1) NOT NULL DEFAULT 0 AFTER registration_category");
  await add('customers', 'tds_rate', "ALTER TABLE customers ADD COLUMN tds_rate DECIMAL(5,2) DEFAULT NULL AFTER credit_limit");
  await add('customers', 'tcs_rate', "ALTER TABLE customers ADD COLUMN tcs_rate DECIMAL(5,2) DEFAULT NULL AFTER tds_rate");
  await add('customers', 'tds_threshold', "ALTER TABLE customers ADD COLUMN tds_threshold DECIMAL(14,2) DEFAULT NULL AFTER tcs_rate");
  await add('customers', 'tcs_threshold', "ALTER TABLE customers ADD COLUMN tcs_threshold DECIMAL(14,2) DEFAULT NULL AFTER tds_threshold");

  // ---- vendors ----
  await add('vendors', 'registration_category', "ALTER TABLE vendors ADD COLUMN registration_category VARCHAR(20) DEFAULT NULL AFTER gstin");
  await add('vendors', 'tax_exempt', "ALTER TABLE vendors ADD COLUMN tax_exempt TINYINT(1) NOT NULL DEFAULT 0 AFTER registration_category");
  await add('vendors', 'rcm_default', "ALTER TABLE vendors ADD COLUMN rcm_default TINYINT(1) NOT NULL DEFAULT 0 AFTER tax_exempt");
  await add('vendors', 'tds_rate', "ALTER TABLE vendors ADD COLUMN tds_rate DECIMAL(5,2) DEFAULT NULL AFTER pincode");
  await add('vendors', 'tds_threshold', "ALTER TABLE vendors ADD COLUMN tds_threshold DECIMAL(14,2) DEFAULT NULL AFTER tds_rate");

  // ---- backfill classification ----
  await c.query(
    `UPDATE customers SET registration_category = CASE WHEN gstin IS NOT NULL AND gstin <> '' THEN 'registered' ELSE 'unregistered' END
     WHERE registration_category IS NULL OR registration_category = ''`
  );
  await c.query(
    `UPDATE vendors SET registration_category = CASE WHEN gstin IS NOT NULL AND gstin <> '' THEN 'registered' ELSE 'unregistered' END
     WHERE registration_category IS NULL OR registration_category = ''`
  );
  console.log('backfilled registration_category from GSTIN');

  const [cu] = await c.query('SELECT id, name, gstin, registration_category FROM customers ORDER BY id');
  const [ve] = await c.query('SELECT id, name, gstin, registration_category, rcm_default FROM vendors ORDER BY id');
  console.log('customers ->', cu);
  console.log('vendors ->', ve);
  console.log('MIG OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });