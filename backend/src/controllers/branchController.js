const { getPool } = require('../db');
const { audit } = require('../utils/audit');
const { getActiveBranch, syncBranchProfile, validateBranch } = require('../utils/branch');

const FIELDS = [
  'branch_name','company_name','gstin','pan','address_line1','address_line2','city','state','state_code',
  'pincode','phone','email','invoice_prefix','invoice_start_number','is_head_office','is_active',
];
const NUM = ['invoice_start_number'];
const BOOL = ['is_head_office','is_active'];

async function list(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM branches ORDER BY is_head_office DESC, id');
    const [[cs]] = await pool.query('SELECT active_branch_id FROM company_settings ORDER BY id LIMIT 1');
    res.json({ data: rows, activeBranchId: cs && cs.active_branch_id || null });
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const b = req.body || {};
    const err = validateBranch(b);
    if (err) return res.status(400).json({ error: err });
    const pool = getPool();
    const values = {};
    for (const f of FIELDS) {
      if (b[f] !== undefined) values[f] = BOOL.includes(f) ? (b[f] ? 1 : 0) : NUM.includes(f) ? Number(b[f]) : (b[f] === '' ? null : b[f]);
    }
    if (!values.branch_name) return res.status(400).json({ error: 'Branch name is required.' });
    if (!values.company_name) values.company_name = values.branch_name;
    const keys = Object.keys(values);
    const cols = keys.join(',');
    const ph = keys.map(() => '?').join(',');
    const [r] = await pool.query(`INSERT INTO branches (${cols}) VALUES (${ph})`, Object.values(values));
    await audit(req, 'CREATE', 'branch', r.insertId, { branch_name: values.branch_name, gstin: values.gstin || null });
    res.status(201).json({ id: r.insertId, message: 'Branch created.' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'A branch with this name already exists.' });
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM branches WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Branch not found.' });
    const err = validateBranch({ ...rows[0], ...b });
    if (err) return res.status(400).json({ error: err });

    const sets = [];
    const params = [];
    for (const f of FIELDS) {
      if (b[f] !== undefined) {
        let v = b[f];
        if (BOOL.includes(f)) v = v ? 1 : 0;
        if (NUM.includes(f)) v = Number(v);
        if (v === '' && !BOOL.includes(f) && !NUM.includes(f)) v = null;
        sets.push(`${f}=?`);
        params.push(v);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(id);
    await pool.query(`UPDATE branches SET ${sets.join(', ')} WHERE id=?`, params);
    await audit(req, 'UPDATE', 'branch', id, { fields: Object.keys(b) });

    const [[active]] = await pool.query('SELECT active_branch_id FROM company_settings ORDER BY id LIMIT 1');
    if (active && Number(active.active_branch_id) === id) {
      const [[cur]] = await pool.query('SELECT * FROM branches WHERE id=?', [id]);
      await syncBranchProfile(pool, cur);
    }
    res.json({ message: 'Branch updated.' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'A branch with this name already exists.' });
    next(e);
  }
}

async function activate(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM branches WHERE id=? AND is_active=1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Branch not found or inactive.' });
    await syncBranchProfile(pool, rows[0]);
    await audit(req, 'ACTIVATE', 'branch', id, { branch_name: rows[0].branch_name });
    res.json({ message: `Active unit switched to "${rows[0].branch_name}". Invoices will now use its profile, GSTIN and billing series.` });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM branches WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Branch not found.' });
    if (Number(rows[0].is_head_office) === 1) return res.status(400).json({ error: 'The head office cannot be removed. Deactivate branches instead.' });
    const [[active]] = await pool.query('SELECT COUNT(*) AS n, SUM(active_branch_id=? AND active_branch_id IS NOT NULL) AS isActive FROM company_settings', [id]);
    if (Number(active.isActive) > 0) return res.status(400).json({ error: 'Deactivate this branch elsewhere first: it is the active unit.' });
    const [[others]] = await pool.query('SELECT COUNT(*) AS n FROM branches WHERE is_active=1 AND id<>?', [id]);
    if (Number(others.n) === 0) return res.status(400).json({ error: 'At least one active unit must remain.' });
    await pool.query('UPDATE branches SET is_active=0 WHERE id=?', [id]);
    await audit(req, 'DELETE', 'branch', id, { branch_name: rows[0].branch_name });
    res.json({ message: 'Unit deactivated.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, update, activate, remove };