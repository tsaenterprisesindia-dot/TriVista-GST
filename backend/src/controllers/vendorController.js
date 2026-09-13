const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');
const { audit } = require('../utils/audit');

async function list(req, res, next) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const pool = getPool();
    const where = [];
    const params = [];
    if (q) {
      where.push('(name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR gstin LIKE ? OR vendor_code LIKE ? OR city LIKE ? OR email LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);
    const [rows] = await pool.query(
      `SELECT id,vendor_code,name,legal_name,company_name,gstin,registration_category,tax_exempt,rcm_default,pan,phone,email,address_line1,city,state,state_code,pincode,opening_balance,tds_rate,tds_threshold,is_active,created_at
       FROM vendors ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(`SELECT COUNT(*) AS total FROM vendors ${whereSql}`, params);
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

const CATEGORIES = ['registered', 'unregistered', 'composition', 'sez', 'export'];
const cleanCat = (v) => (CATEGORIES.includes(v) ? v : null);

async function create(req, res, next) {
  try {
    const b = req.body || {};
    if (!b.name) return res.status(400).json({ error: 'Name is required.' });
    if (!b.legal_name) return res.status(400).json({ error: 'Legal name is required.' });
    if (b.gstin && !isValidGstin(b.gstin)) return res.status(400).json({ error: 'Invalid GSTIN format.' });
    const pool = getPool();
    const [mx] = await pool.query('SELECT COALESCE(MAX(id),0) AS mx FROM vendors');
    const code = `VEND-${pad((mx[0].mx || 0) + 1, 4)}`;
    const [r] = await pool.query(
      `INSERT INTO vendors (vendor_code,name,legal_name,company_name,gstin,registration_category,tax_exempt,rcm_default,pan,phone,email,address_line1,city,state,state_code,pincode,opening_balance,tds_rate,tds_threshold,is_active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code, b.name, b.legal_name, b.company_name || null, b.gstin || null, cleanCat(b.registration_category), b.tax_exempt ? 1 : 0, b.rcm_default ? 1 : 0,
       b.pan || null, b.phone || null, b.email || null, b.address_line1 || null, b.city || null, b.state || null,
       b.state_code || null, b.pincode || null, Number(b.opening_balance) || 0,
       b.tds_rate == null ? null : Number(b.tds_rate), b.tds_threshold == null ? null : Number(b.tds_threshold),
       b.is_active === undefined ? 1 : b.is_active ? 1 : 0]
    );
    await audit(req, 'CREATE', 'vendor', r.insertId, { name: b.name, gstin: b.gstin || null, pan: b.pan || null });
    res.status(201).json({ id: r.insertId, vendor_code: code, message: 'Vendor created.' });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!id) return res.status(400).json({ error: 'Vendor id required.' });
    if (b.gstin !== undefined && b.gstin !== '' && !isValidGstin(b.gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format.' });
    }
    const [[exists]] = await getPool().query('SELECT id FROM vendors WHERE id=?', [id]);
    if (!exists) return res.status(404).json({ error: 'Vendor not found.' });
    const fields = ['name','legal_name','company_name','gstin','pan','phone','email','address_line1','city','state','state_code','pincode','opening_balance','is_active'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (b[f] !== undefined) {
        let val = b[f];
        if (f === 'is_active') val = val ? 1 : 0;
        sets.push(`${f}=?`);
        params.push(val);
      }
    }
    if (b.registration_category !== undefined) { sets.push('registration_category=?'); params.push(cleanCat(b.registration_category)); }
    if (b.tax_exempt !== undefined) { sets.push('tax_exempt=?'); params.push(b.tax_exempt ? 1 : 0); }
    if (b.rcm_default !== undefined) { sets.push('rcm_default=?'); params.push(b.rcm_default ? 1 : 0); }
    for (const f of ['tds_rate','tds_threshold']) {
      if (b[f] !== undefined) {
        if (b[f] === '' || b[f] == null) sets.push(`${f}=NULL`);
        else { sets.push(`${f}=?`); params.push(Number(b[f])); }
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(id);
    await getPool().query(`UPDATE vendors SET ${sets.join(', ')} WHERE id=?`, params);
    await audit(req, 'UPDATE', 'vendor', id, { fields: Object.fromEntries(fields.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) });
    res.json({ message: 'Vendor updated.' });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [v] = await pool.query('SELECT name FROM vendors WHERE id=?', [id]);
    const [[ref]] = await pool.query(`SELECT (SELECT COUNT(*) FROM purchase_bills WHERE vendor_id=?) AS refs`, [id]);
    const refs = Number(ref && ref.refs) || 0;
    if (refs > 0) {
      await pool.query('UPDATE vendors SET is_active=0 WHERE id=?', [id]);
      await audit(req, 'DEACTIVATE', 'vendor', id, { name: v[0]?.name || null });
      return res.json({ message: 'Vendor has transactions - deactivated instead of deleted.', deactivated: true });
    }
    const [r] = await pool.query('DELETE FROM vendors WHERE id=?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Vendor not found.' });
    await audit(req, 'DELETE', 'vendor', id, { name: v[0]?.name || null });
    res.json({ message: 'Vendor deleted.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, update, remove };