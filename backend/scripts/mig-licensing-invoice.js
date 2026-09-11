const mysql = require("mysql2/promise");

(async () => {
  const c = await mysql.createConnection({
    host: "localhost", port: 3306, user: "root", password: "", database: "triveni_gst_erp", multipleStatements: true,
  });
  const [[cols]] = await c.query("SHOW COLUMNS FROM client_licenses LIKE 'invoice_id'");
  if (!cols) {
    await c.query("ALTER TABLE client_licenses ADD COLUMN invoice_id INT UNSIGNED DEFAULT NULL AFTER notes, ADD KEY idx_lic_invoice (invoice_id)");
    console.log("added client_licenses.invoice_id");
  } else {
    console.log("client_licenses.invoice_id already present");
  }
  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });