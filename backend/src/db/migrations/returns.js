const { getPool } = require('../../db');

async function migrate() {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Track returned quantities per invoice line
    const [col] = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='invoice_items' AND COLUMN_NAME='returned_qty'"
    );
    if (col[0].c === 0) {
      await conn.query("ALTER TABLE invoice_items ADD COLUMN returned_qty DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER total");
      console.log('  + invoice_items.returned_qty');
    }

    // 2. Distinguish payments from refunds
    const [pt] = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME='payment_type'"
    );
    if (pt[0].c === 0) {
      await conn.query("ALTER TABLE payments ADD COLUMN payment_type ENUM('PAYMENT','REFUND') NOT NULL DEFAULT 'PAYMENT' AFTER amount");
      console.log('  + payments.payment_type');
    }

    // 3. Returns header
    const [rt] = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='returns'"
    );
    if (rt[0].c === 0) {
      await conn.query(`
        CREATE TABLE returns (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          return_number VARCHAR(60) NOT NULL,
          return_date DATE NOT NULL,
          invoice_id INT UNSIGNED NOT NULL,
          invoice_number VARCHAR(60) NOT NULL,
          customer_id INT UNSIGNED NOT NULL,
          customer_name VARCHAR(190) DEFAULT NULL,
          reason VARCHAR(255) DEFAULT NULL,
          type ENUM('RETURN','EXCHANGE') NOT NULL DEFAULT 'RETURN',
          subtotal DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          cgst_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          sgst_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          utgst_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          igst_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          cess_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          tax_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          round_off DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          grand_total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          refunded_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          refund_status ENUM('PENDING','PARTIAL','REFUNDED','CREDITED') NOT NULL DEFAULT 'PENDING',
          credit_note_id INT UNSIGNED DEFAULT NULL,
          credit_note_number VARCHAR(60) DEFAULT NULL,
          exchange_invoice_id INT UNSIGNED DEFAULT NULL,
          exchange_invoice_number VARCHAR(60) DEFAULT NULL,
          created_by INT UNSIGNED DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_return_number (return_number),
          KEY idx_return_invoice (invoice_id),
          KEY idx_return_customer (customer_id)
        ) ENGINE=InnoDB
      `);
      console.log('  + returns table');
    }

    // 4. Return line items
    const [ri] = await conn.query(
      "SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='return_items'"
    );
    if (ri[0].c === 0) {
      await conn.query(`
        CREATE TABLE return_items (
          id INT UNSIGNED NOT NULL AUTO_INCREMENT,
          return_id INT UNSIGNED NOT NULL,
          invoice_item_id INT UNSIGNED NOT NULL,
          product_id INT UNSIGNED DEFAULT NULL,
          item_name VARCHAR(190) NOT NULL,
          hsn_code VARCHAR(20) DEFAULT NULL,
          gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
          quantity DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          unit VARCHAR(30) DEFAULT 'PCS',
          unit_price DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          discount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          taxable_value DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          cgst_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          sgst_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          utgst_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          igst_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          cess_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          total DECIMAL(14,2) NOT NULL DEFAULT 0.00,
          PRIMARY KEY (id),
          KEY idx_return_item_return (return_id),
          KEY idx_return_item_inv_item (invoice_item_id)
        ) ENGINE=InnoDB
      `);
      console.log('  + return_items table');
    }

    await conn.commit();
    console.log('Returns migration complete.');
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { migrate };
if (require.main === module) migrate().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
