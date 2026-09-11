const mysql = require("mysql2/promise");

(async () => {
  const c = await mysql.createConnection({
    host: "localhost", port: 3306, user: "root", password: "", database: "triveni_gst_erp", multipleStatements: true,
  });
  const [cols] = await c.query("SHOW COLUMNS FROM vendors LIKE 'company_name'");
  if (!cols.length) {
    await c.query("ALTER TABLE vendors ADD COLUMN company_name VARCHAR(190) DEFAULT NULL AFTER name");
    console.log("added vendors.company_name");
  } else {
    console.log("vendors.company_name already present");
  }
  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });