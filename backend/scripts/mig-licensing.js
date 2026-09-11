const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

(async () => {
  const c = await mysql.createConnection({
    host: "localhost",
    port: 3306,
    user: "root",
    password: "",
    database: "triveni_gst_erp",
    multipleStatements: true,
  });

  const schema = fs.readFileSync(path.join(__dirname, "..", "src", "db", "schema.sql"), "utf8");
  const blocks = schema.split("CREATE TABLE");
  for (const b of blocks) {
    const head = b.split("\n")[0];
    if (!/support_messages|license_plans|client_licenses|license_renewals/.test(b)) continue;
    const sql = (b.startsWith(' IF NOT EXISTS') ? b : ('CREATE TABLE' + b)).trim();
    try {
      await c.query(sql.replace(/;\s*$/, ""));
      console.log("created:", head);
    } catch (e) {
      if (!/already exists/i.test(e.message)) throw e;
      console.log("exists:", head);
    }
  }

  const [[n]] = await c.query("SELECT COUNT(*) AS n FROM license_plans");
  if (Number(n.n) === 0) {
    await c.query(
      `INSERT INTO license_plans (name,type,duration_days,price,seats,is_active) VALUES
       ('Free Trial - 30 Days','TRIAL',30,0.00,1,1),
       ('Monthly Subscription','SUBSCRIPTION',30,500.00,1,1),
       ('Yearly Subscription','SUBSCRIPTION',365,5000.00,1,1),
       ('One-Time Lifetime License','LIFETIME',NULL,15000.00,1,1)`
    );
    console.log("seeded license_plans");
  }
  const [tbls] = await c.query("SHOW TABLES LIKE 'client_licenses'");
  console.log("client_licenses exists:", tbls.length > 0);
  const [tbls2] = await c.query("SHOW TABLES LIKE 'license_renewals'");
  console.log("license_renewals exists:", tbls2.length > 0);
  await c.end();
  console.log("MIG OK");
})().catch((e) => { console.error(e.message); process.exit(1); });