const mysql = require("mysql2/promise");

(async () => {
  const c = await mysql.createConnection({
    host: "localhost", port: 3306, user: "root", password: "", database: "triveni_gst_erp", multipleStatements: true,
  });
  const [cols] = await c.query("SHOW COLUMNS FROM users LIKE 'accepted_terms_at'");
  if (!cols.length) {
    await c.query("ALTER TABLE users ADD COLUMN accepted_terms_at DATETIME DEFAULT NULL AFTER is_active");
    console.log("added users.accepted_terms_at");
  } else {
    console.log("users.accepted_terms_at already present");
  }
  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });