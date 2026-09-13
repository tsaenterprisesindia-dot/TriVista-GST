// mig-12-party-legal-trade.js
// Adds a compulsory `legal_name` column to customers and vendors so parties can
// carry three names: Name (compulsory), Legal Name (compulsory) and Trade Name
// (optional = existing company_name column). Backfills legal_name from name for
// existing rows, then enforces NOT NULL. Idempotent; prints MIG OK.
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

  const ensure = async (table, col, ddl) => {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
    if (!cols.length) {
      await c.query(ddl);
      console.log(`added ${table}.${col}`);
      await c.query(`UPDATE ${table} SET ${col} = TRIM(name) WHERE ${col} IS NULL OR ${col} = ''`);
      console.log(`backfilled ${table}.${col} from name`);
      return true;
    }
    console.log(`${table}.${col} already present`);
    return false;
  };

  const addedCust = await ensure('customers', 'legal_name', "ALTER TABLE customers ADD COLUMN legal_name VARCHAR(190) DEFAULT NULL AFTER name");
  const addedVend = await ensure('vendors', 'legal_name', "ALTER TABLE vendors ADD COLUMN legal_name VARCHAR(190) DEFAULT NULL AFTER company_name");

  // Make the column compulsory at the DB level (only matters if a fresh column was added).
  for (const t of ['customers', 'vendors']) {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${t} LIKE 'legal_name'`);
    if (cols.length && String(cols[0].Null).toUpperCase() === 'YES') {
      await c.query(`ALTER TABLE ${t} MODIFY legal_name VARCHAR(190) NOT NULL`);
      console.log(`${t}.legal_name -> NOT NULL`);
    }
  }

  const [[cRows]] = await c.query('SELECT COUNT(*) AS legal_filled FROM customers WHERE legal_name IS NOT NULL AND legal_name <> \'\'');
  const [[vRows]] = await c.query('SELECT COUNT(*) AS legal_filled FROM vendors WHERE legal_name IS NOT NULL AND legal_name <> \'\'');
  console.log(`row check -> customers.legal_name filled=${cRows.legal_filled}, vendors.legal_name filled=${vRows.legal_filled}`);

  await c.end();
  console.log('MIG OK');
})().catch((e) => { console.error(e.message); process.exit(1); });