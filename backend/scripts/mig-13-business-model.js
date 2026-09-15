// mig-13-business-model.js
// Three-business-model packs groundwork (P0):
//   company_settings.business_model  -> 'general' | 'manufacturing' | 'import_export' (default 'general')
//   company_settings.feature_flags   -> JSON object of per-company feature overrides { '<feature>': true|false }
//   license_plans.business_model     -> which model pack a plan unlocks (plan <-> pack wiring)
//   license_plans.features           -> JSON array/object of extra features granted by the plan (add-ons)
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

  const ensureCol = async (table, col, ddl) => {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
    if (!cols.length) {
      await c.query(`ALTER TABLE ${table} ${ddl}`);
      console.log(`added ${table}.${col}`);
    } else {
      console.log(`${table}.${col} already present`);
    }
  };

  await ensureCol(
    'company_settings',
    'business_model',
    "ADD COLUMN business_model ENUM('general','manufacturing','import_export') NOT NULL DEFAULT 'general' AFTER business_type"
  );
  await ensureCol(
    'company_settings',
    'feature_flags',
    "ADD COLUMN feature_flags JSON DEFAULT NULL AFTER business_model"
  );
  await ensureCol(
    'license_plans',
    'business_model',
    "ADD COLUMN business_model ENUM('general','manufacturing','import_export') NOT NULL DEFAULT 'general' AFTER type"
  );
  await ensureCol(
    'license_plans',
    'features',
    "ADD COLUMN features JSON DEFAULT NULL AFTER business_model"
  );

  // Backfill: a NULL/empty features bag counts as no add-ons.
  await c.query("UPDATE license_plans SET features = JSON_OBJECT() WHERE features IS NULL");
  console.log('backfilled license_plans.features to empty JSON');

  const [rows] = await c.query(
    'SELECT business_model, feature_flags FROM company_settings ORDER BY id LIMIT 1'
  );
  console.log('company row ->', rows[0]);
  const [pl] = await c.query('SELECT id, name, business_model, features FROM license_plans ORDER BY id LIMIT 4');
  console.log('plans ->', pl);

  await c.end();
  console.log('MIG OK');
})().catch((e) => { console.error(e.message); process.exit(1); });