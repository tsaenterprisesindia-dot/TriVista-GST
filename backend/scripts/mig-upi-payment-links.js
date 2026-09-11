const mysql = require("mysql2/promise");

(async () => {
  const c = await mysql.createConnection({
    host: "localhost", port: 3306, user: "root", password: "", database: "triveni_gst_erp", multipleStatements: true,
  });
  const [[upiCol]] = await c.query("SHOW COLUMNS FROM company_settings LIKE 'upi_id'");
  if (!upiCol) {
    await c.query("ALTER TABLE company_settings ADD COLUMN upi_id VARCHAR(50) DEFAULT NULL AFTER bank_ifsc, ADD COLUMN upi_beneficiary VARCHAR(190) DEFAULT NULL AFTER upi_id");
    console.log("added company_settings.upi_id / upi_beneficiary");
  } else {
    console.log("company_settings upi fields already present");
  }
  const [[tbl]] = await c.query("SHOW TABLES LIKE 'payment_links'");
  if (!tbl) {
    await c.query(`CREATE TABLE payment_links (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      token CHAR(32) NOT NULL,
      invoice_id INT UNSIGNED DEFAULT NULL,
      amount DECIMAL(14,2) DEFAULT NULL,
      note VARCHAR(255) DEFAULT NULL,
      status ENUM('active','paid','cancelled') NOT NULL DEFAULT 'active',
      paid_at TIMESTAMP NULL DEFAULT NULL,
      created_by INT UNSIGNED DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_paylink_token (token),
      KEY idx_paylink_invoice (invoice_id),
      KEY idx_paylink_status (status)
    ) ENGINE=InnoDB`);
    console.log("created payment_links");
  } else {
    console.log("payment_links already present");
  }
  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });