/**
 * mig-all.js - tracked schema migrations runner.
 *
 * Applies backend/scripts/mig-*.js files EXACTLY ONCE. Each successful run is
 * recorded in the schema_migrations table (name + sha256 checksum), so re-running
 * this script never re-executes an applied migration (prevents duplicate seeds,
 * e.g. branched/plans, that naive re-runs can cause).
 *
 * Usage:
 *   node scripts/mig-all.js                 # apply any pending migrations
 *   node scripts/mig-all.js --mark-all-applied  # record existing migrations as applied without running
 *                                               (safe baseline for an already-migrated database)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const mysql = require('mysql2/promise');

const DIR = __dirname;

// Explicit dependency order. New migrations must be added here.
const ORDER = [
  'mig-vendor-company-name.js',
  'mig-upi-payment-links.js',
  'mig-licensing.js',
  'mig-licensing-invoice.js',
  'mig-terms-acceptance.js',
  'mig-06-ledger.js',
  'mig-07-business-master.js',
  'mig-08-branches.js',
  'mig-09-parties.js',
  'mig-10-invoice-type.js',
];

const DB = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'triveni_gst_erp',
  multipleStatements: true,
};

const checksum = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, file))).digest('hex');

const runFile = (file) =>
  new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(DIR, file)], { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve(stdout);
    });
  });

(async () => {
  const c = await mysql.createConnection(DB);
  await c.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INT UNSIGNED NOT NULL AUTO_INCREMENT,
       name VARCHAR(255) NOT NULL,
       checksum VARCHAR(64) NOT NULL,
       applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
       PRIMARY KEY (id),
       UNIQUE KEY uk_mig_name (name)
     ) ENGINE=InnoDB`
  );

  const existing = ORDER.filter((f) => /^mig-.*\.js$/.test(f) && fs.existsSync(path.join(DIR, f)));
  const [[{ n: appliedN }]] = await c.query('SELECT COUNT(*) AS n FROM schema_migrations');

  if (process.argv.includes('--mark-all-applied')) {
    let inserted = 0;
    for (const f of existing) {
      const [r] = await c.query('INSERT IGNORE INTO schema_migrations (name, checksum) VALUES (?, ?)', [f, checksum(f)]);
      inserted += r.affectedRows;
    }
    console.log(`MIG-ALL: baseline recorded ${inserted} migration(s) as applied (${existing.length} on disk, ${appliedN} already recorded).`);
    await c.end();
    process.exit(0);
  }

  const applied = new Set((await c.query('SELECT name FROM schema_migrations'))[0].map((r) => r.name));
  const pending = existing.filter((f) => !applied.has(f));

  if (!pending.length) {
    console.log(`MIG-ALL: nothing to apply - all ${appliedN} migration(s) already recorded.`);
    await c.end();
    process.exit(0);
  }

  for (const f of pending) {
    const started = Date.now();
    try {
      const out = await runFile(f);
      if (!/MIG OK/.test(out)) throw new Error(`script did not report MIG OK:\n${out}`);
      await c.query('INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)', [f, checksum(f)]);
      console.log(`MIG-ALL: applied ${f} (${Date.now() - started}ms)`);
    } catch (e) {
      console.error(`MIG-ALL: ${f} FAILED - ${e.message}`);
      await c.end();
      process.exit(1);
    }
  }

  await c.end();
  console.log('MIG-ALL OK');
})().catch((e) => {
  console.error('MIG-ALL ERR:', e.message);
  process.exit(1);
});