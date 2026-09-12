// mig-11-utgst.js
// Adds UTGST support: intra-state supplies from a union territory register
// (state codes 04 / 26 / 38) carry CGST + UTGST instead of CGST + SGST.
// Adds utgst columns to invoices / invoice_items / purchase_bills /
// purchase_bill_items and the UTGST ledger accounts (2400 output, 2900 input).
// Idempotent; prints MIG OK.
const mysql = require('mysql2/promise');

const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'triveni_gst_erp',
};

(async () => {
  const c = await mysql.createConnection(DB);

  const addCol = async (table, col, ddl) => {
    const [[r]] = await c.query(`SHOW COLUMNS FROM ${table} LIKE '${col}'`);
    if (!r) {
      await c.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
      console.log(`added ${table}.${col}`);
    } else {
      console.log(`${table}.${col} already exists`);
    }
  };

  await addCol('invoices', 'utgst_total', "`utgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER `sgst_total`");
  await addCol('invoice_items', 'utgst_amount', "`utgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER `sgst_amount`");
  await addCol('purchase_bills', 'utgst_total', "`utgst_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER `sgst_total`");
  await addCol('purchase_bill_items', 'utgst_amount', "`utgst_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER `sgst_amount`");

  const [[outUtgst]] = await c.query(`SELECT id FROM accounts WHERE code='2400'`);
  if (!outUtgst) {
    await c.query(`INSERT INTO accounts (code,name,type) VALUES ('2400','GST Output (UTGST Payable)','LIABILITY')`);
    console.log('added account 2400 GST Output (UTGST Payable)');
  } else {
    console.log('account 2400 already exists');
  }
  const [[inUtgst]] = await c.query(`SELECT id FROM accounts WHERE code='2900'`);
  if (!inUtgst) {
    await c.query(`INSERT INTO accounts (code,name,type) VALUES ('2900','Input UTGST Credit','ASSET')`);
    console.log('added account 2900 Input UTGST Credit');
  } else {
    console.log('account 2900 already exists');
  }

  console.log('MIG OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });