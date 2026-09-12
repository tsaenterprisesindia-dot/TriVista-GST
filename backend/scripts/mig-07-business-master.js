// mig-07-business-master.js
// Adds the Business/Enterprise Master fields missing from company_settings:
//   legal_name   -> registered legal name (used as e-Invoice LglNm)
//   trade_name   -> brand / trade name (used as e-Invoice TrdNm)
//   constitution -> legal constitution (Sole Proprietorship, Partnership, Pvt Ltd, LLP, ...)
// Backfills legal_name from company_name where blank. Idempotent; prints MIG OK.
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

  const add = async (col, ddl) => {
    const [cols] = await c.query(`SHOW COLUMNS FROM company_settings LIKE '${col}'`);
    if (!cols.length) {
      await c.query(ddl);
      console.log(`added company_settings.${col}`);
    } else {
      console.log(`company_settings.${col} already present`);
    }
  };

  await add('legal_name', "ALTER TABLE company_settings ADD COLUMN legal_name VARCHAR(190) DEFAULT NULL AFTER company_name");
  await add('trade_name', "ALTER TABLE company_settings ADD COLUMN trade_name VARCHAR(190) DEFAULT NULL AFTER legal_name");
  await add('constitution', "ALTER TABLE company_settings ADD COLUMN constitution VARCHAR(60) DEFAULT NULL AFTER trade_name");

  await c.query("UPDATE company_settings SET legal_name = TRIM(company_name) WHERE legal_name IS NULL OR legal_name = ''");
  console.log('backfilled legal_name from company_name');

  const [rows] = await c.query('SELECT legal_name, trade_name, constitution FROM company_settings ORDER BY id LIMIT 1');
  console.log('row ->', rows[0]);

  await c.end();
  console.log('MIG OK');
})().catch((e) => { console.error(e.message); process.exit(1); });
