// mig-14-loyalty.js
// Loyalty points (Stage 3): earn/burn ledger for customers.
//   loyalty_rules     - global earn rate, redemption value, min bill, expiry (one active row)
//   customer_points   - per-customer running balance
//   points_ledger     - immutable EARN/BURN/EXPIRE/ADJUST entries
// Add new payment mode 'POINTS' to payments.mode ENUM for redemption at POS.
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

  const hasTable = async (t) => (await c.query(`SHOW TABLES LIKE '${t}'`))[0].length > 0;
  const hasCol = async (t, k) => (await c.query(`SHOW COLUMNS FROM ${t} LIKE '${k}'`))[0].length > 0;

  if (!(await hasTable('loyalty_rules'))) {
    await c.query(`
      CREATE TABLE loyalty_rules (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        name VARCHAR(90) NOT NULL DEFAULT 'Default',
        earn_points_per_100 DECIMAL(8,2) NOT NULL DEFAULT 1.00 COMMENT 'points earned per Rs.100 of taxable billed value',
        redeem_points_per_1 DECIMAL(8,2) NOT NULL DEFAULT 1.00 COMMENT 'redemption value in Rs. per point',
        min_bill_amount DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'min bill to earn/burn',
        expiry_months TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = never expires',
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_by INT UNSIGNED DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB`);
    await c.query(
      "INSERT INTO loyalty_rules (name, earn_points_per_100, redeem_points_per_1, min_bill_amount, expiry_months, is_active) VALUES ('Default', 1.00, 1.00, 0.00, 0, 1)"
    );
    console.log('created loyalty_rules + default row');
  } else {
    console.log('loyalty_rules already present');
  }

  if (!(await hasTable('customer_points'))) {
    await c.query(`
      CREATE TABLE customer_points (
        customer_id INT UNSIGNED NOT NULL,
        points_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        total_earned DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        total_burned DECIMAL(14,2) NOT NULL DEFAULT 0.00,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (customer_id),
        CONSTRAINT fk_cpoint_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    console.log('created customer_points');
  } else {
    console.log('customer_points already present');
  }

  if (!(await hasTable('points_ledger'))) {
    await c.query(`
      CREATE TABLE points_ledger (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        customer_id INT UNSIGNED NOT NULL,
        date DATE NOT NULL,
        type ENUM('EARN','BURN','EXPIRE','ADJUST') NOT NULL,
        points DECIMAL(14,2) NOT NULL COMMENT 'positive earn/add, negative burn/expire',
        invoice_id INT UNSIGNED DEFAULT NULL,
        invoice_number VARCHAR(60) DEFAULT NULL,
        note VARCHAR(255) DEFAULT NULL,
        created_by INT UNSIGNED DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_pledger_customer (customer_id),
        KEY idx_pledger_invoice (invoice_id),
        CONSTRAINT fk_pledger_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`);
    console.log('created points_ledger');
  } else {
    console.log('points_ledger already present');
  }

  // Redeeming points at POS becomes a payment leg: extend the ENUM safely.
  const [colInfo] = await c.query(`SHOW COLUMNS FROM payments LIKE 'mode'`);
  const modeEnum = colInfo[0] && (colInfo[0].Type || '');
  if (modeEnum && !/POINTS/.test(modeEnum)) {
    await c.query(`
      ALTER TABLE payments
      MODIFY COLUMN mode ENUM('CASH','CARD','UPI','BANK','OTHER','POINTS') NOT NULL DEFAULT 'CASH'`);
    console.log("payments.mode ENUM extended with 'POINTS'");
  } else {
    console.log('payments.mode already supports POINTS');
  }

  if (!(await hasCol('customers', 'points_balance'))) {
    // Optional shadow column on customers for quick reads in the picker.
    await c.query('ALTER TABLE customers ADD COLUMN points_balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER credit_limit');
    await c.query(
      'UPDATE customers c JOIN customer_points cp ON cp.customer_id=c.id SET c.points_balance=cp.points_balance'
    );
    console.log('customers.points_balance added + sync');
  } else {
    console.log('customers.points_balance already present');
  }

  const [rows] = await c.query('SELECT * FROM loyalty_rules ORDER BY id');
  console.log('loyalty rules ->', rows);
  const [pl] = await c.query('SELECT customer_id, points_balance FROM customer_points LIMIT 3');
  console.log('customer_points sample ->', pl);

  await c.end();
  console.log('MIG OK');
})().catch((e) => { console.error(e.message); process.exit(1); });