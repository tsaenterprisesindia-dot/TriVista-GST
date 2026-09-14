const { getPool } = require('../db');
const bcrypt = require('bcryptjs');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isValidGstin } = require('../utils/gst');
const { audit } = require('../utils/audit');

async function getSettings(_req, res, next) {
  try {
    const [rows] = await getPool().query('SELECT * FROM company_settings ORDER BY id LIMIT 1');
    if (!rows.length) {
      return res.status(404).json({ error: 'Company settings not found. Run db:seed.' });
    }
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
}

async function updateSettings(req, res, next) {
  try {
    const b = req.body || {};
    if (b.gstin && !isValidGstin(b.gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format.' });
    }
    const allowed = [
      'company_name','legal_name','trade_name','constitution','gstin','pan','tan','address_line1','address_line2','city','state','state_code',
      'pincode','phone','email','website','logo_path','invoice_prefix','invoice_start_number',
      'invoice_footer_note','bank_name','bank_account_no','bank_ifsc','upi_id','upi_beneficiary','gst_tax_preference','round_off',
      'business_type',
      'e_invoice_enabled','aggregate_turnover_crores','apply_tds','apply_tcs','tds_rate','tcs_rate',
      'tds_threshold','tcs_threshold','discount_limit_pct',
    ];
    const numFields = ['invoice_start_number','round_off','aggregate_turnover_crores','tds_rate','tcs_rate','tds_threshold','tcs_threshold','discount_limit_pct'];
    const boolFields = ['e_invoice_enabled','apply_tds','apply_tcs'];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (b[f] !== undefined) {
        let v = b[f];
        if (numFields.includes(f)) v = Number(v);
        if (boolFields.includes(f)) v = v ? 1 : 0;
        sets.push(`${f}=?`);
        params.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    const pool = getPool();
    const [rows] = await pool.query('SELECT id FROM company_settings ORDER BY id LIMIT 1');
    // If no row, create one
    if (!rows.length) {
      const fill = allowed.reduce((acc, k) => ({ ...acc, [k]: b[k] ?? null }), {});
      const cols = Object.keys(fill).join(',');
      const vals = Object.values(fill).map(() => '?').join(',');
      await pool.query(`INSERT INTO company_settings (${cols}) VALUES (${vals})`, Object.values(fill));
      return res.status(201).json({ message: 'Company settings created.' });
    }
    params.push(rows[0].id);
    await pool.query(`UPDATE company_settings SET ${sets.join(', ')} WHERE id=?`, params);
    await audit(req, 'UPDATE', 'company_settings', rows[0].id, { fields: Object.fromEntries(allowed.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) });
    res.json({ message: 'Company settings updated.' });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/company/clear-data  { password }
 * Wipes all business & demo data (invoices, bills, products, stock, customers,
 * vendors, payments, logs, API keys, transactions) but keeps the login,
 * company profile, chart of accounts, HSN masters and AI settings.
 * Requires the requesting user's password as confirmation.
 */
const BUSINESS_TABLES = [
  'notifications',
  'audit_logs',
  'invoice_items',
  'payments',
  'einvoice_logs',
  'ewaybill_logs',
  'purchase_bill_items',
  'stock_movements',
  'reconciliation_rows',
  'invoices',
  'purchase_bills',
  'transactions',
  'reconciliation_imports',
  'api_clients',
  'customers',
  'vendors',
  'products',
  'categories',
];

async function clearData(req, res, next) {
  let conn;
  try {
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Enter your password to confirm.' });
    }
    const pool = getPool();
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();
    for (const t of BUSINESS_TABLES) {
      await conn.query(`DELETE FROM \`${t}\``);
    }
    await conn.commit();

    // Reset auto-increment counters (best-effort, outside txn)
    for (const t of BUSINESS_TABLES) {
      try {
        await pool.query(`ALTER TABLE \`${t}\` AUTO_INCREMENT = 1`);
      } catch (_e) { /* ignore */ }
    }

    res.json({
      message: 'All business & demo data cleared.',
      cleared: BUSINESS_TABLES,
    });
  } catch (e) {
    if (conn) {
      try { await conn.rollback(); } catch (_e) { /* ignore */ }
    }
    next(e);
  } finally {
    if (conn) conn.release();
  }
}

// ---------------- Backup / Restore ----------------
const BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

function dbEnv() {
  const user = process.env.DB_USER || 'root';
  const pass = process.env.DB_PASSWORD || '';
  const name = process.env.DB_NAME || 'triveni_gst_erp';
  const host = process.env.DB_HOST || '127.0.0.1';
  const port = process.env.DB_PORT || '3306';
  return { user, pass, name, host, port };
}

function runDbCmd(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 512 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (err, stdout, stderr) => {
      if (err) {
        err.message = `${err.message} ${String(stderr).slice(0, 2000)}`;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * GET /api/company/backup  (SUPER_ADMIN)
 * Dumps the entire database to a timestamped .sql file.
 */
async function backup(req, res, next) {
  try {
    const { user, pass, name, host, port } = dbEnv();
    const mysqlBin = process.env.MYSQL_BIN || 'I:\\mysql\\bin';
    const dumpBin = path.join(mysqlBin, 'mysqldump.exe');
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T.]/g, '-').slice(0, 19);
    const file = path.join(BACKUP_DIR, `triveni_gst_${stamp}.sql`);
    const args = ['--host=' + host, '--port=' + port, '--user=' + user, ...(pass ? ['--password=' + pass] : []), '--single-transaction', '--routines', '--triggers', name];
    await runDbCmd(dumpBin, args).then(({ stdout }) => fs.writeFileSync(file, stdout));
    await audit(req, 'BACKUP', 'company_settings', null, { file: path.basename(file), size: fs.statSync(file).size });
    res.json({ message: 'Database backed up.', file: path.basename(file), path: file });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/company/backups - list backup files.
 */
async function listBackups(req, res, next) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { file: f, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/company/restore { file, password }  (SUPER_ADMIN)
 * Restores from a backup file. The file must already exist under ./backups.
 */
async function restore(req, res, next) {
  try {
    const { file, password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Enter your password to confirm.' });
    }
    const pool = getPool();
    const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect password.' });
    }
    if (!file || file.includes('..') || path.basename(file) !== file) {
      return res.status(400).json({ error: 'Invalid backup file name.' });
    }
    const full = path.join(BACKUP_DIR, file);
    if (!fs.existsSync(full)) return res.status(404).json({ error: 'Backup file not found.' });

    const { user: du, pass, name } = dbEnv();
    const mysqlBin = process.env.MYSQL_BIN || 'I:\\mysql\\bin';
    const mysqlBinPath = path.join(mysqlBin, 'mysql.exe');
    const args = ['--user=' + du, ...(pass ? ['--password=' + pass] : []), name];
    await new Promise((resolve, reject) => {
      const child = require('child_process').spawn(mysqlBinPath, args, { stdio: ['pipe', 'inherit', 'pipe'] });
      fs.createReadStream(full).pipe(child.stdin);
      let errOut = '';
      child.stderr.on('data', (d) => { errOut += d; });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code !== 0) return reject(new Error(`mysql exited ${code}: ${errOut.slice(0, 2000)}`));
        resolve();
      });
    });
    await audit(req, 'RESTORE', 'company_settings', null, { file });
    res.json({ message: 'Database restored from backup.', file });
  } catch (e) {
    next(e);
  }
}

module.exports = { getSettings, updateSettings, clearData, backup, listBackups, restore };