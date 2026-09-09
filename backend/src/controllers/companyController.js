const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');

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
      'company_name','gstin','pan','tan','address_line1','address_line2','city','state','state_code',
      'pincode','phone','email','website','logo_path','invoice_prefix','invoice_start_number',
      'invoice_footer_note','bank_name','bank_account_no','bank_ifsc','gst_tax_preference','round_off',
    ];
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (b[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(b[f]);
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
    res.json({ message: 'Company settings updated.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { getSettings, updateSettings };