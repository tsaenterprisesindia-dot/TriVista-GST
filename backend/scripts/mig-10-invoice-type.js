// mig-10-invoice-type.js
// invoices.invoice_type was enum('B2B','B2C') so EXPORT / CREDIT_NOTE / DEBIT_NOTE / NIL
// were silently truncated to ''. Widen the enum and backfill affected rows from the
// customer registration classification. Idempotent; prints MIG OK.
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

  const [[col]] = await c.query(`SHOW COLUMNS FROM invoices LIKE 'invoice_type'`);
  if (col && !col.Type.includes('EXPORT')) {
    await c.query(
      `ALTER TABLE invoices MODIFY COLUMN invoice_type ENUM('B2B','B2C','CREDIT_NOTE','DEBIT_NOTE','EXPORT','NIL') NOT NULL DEFAULT 'B2C'`
    );
    console.log('invoices.invoice_type widened to include EXPORT / CREDIT_NOTE / DEBIT_NOTE / NIL');
  } else {
    console.log('invoices.invoice_type already supports all document types');
  }

  // Backfill rows that were stored as '' (truncated) using the party classification.
  const [aff] = await c.query(
    `UPDATE invoices i
     JOIN customers cu ON cu.id = i.customer_id
     SET i.invoice_type = CASE
       WHEN cu.registration_category = 'export' THEN 'EXPORT'
       WHEN cu.gstin IS NOT NULL AND cu.gstin <> '' THEN 'B2B'
       ELSE 'B2C'
     END
     WHERE i.invoice_type = '' OR i.invoice_type IS NULL`
  );
  console.log('backfilled invoice_type rows:', aff.affectedRows);

  const [r] = await c.query(
    `SELECT invoice_type, COUNT(*) n FROM invoices GROUP BY invoice_type ORDER BY n DESC`
  );
  console.table(r);
  console.log('MIG OK');
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });