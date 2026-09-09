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
      where.push('(name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR gstin LIKE ? OR customer_code LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like, like);
    }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (Number(page) - 1) * Number(limit);
    const [rows] = await pool.query(
      `SELECT id,customer_code,name,company_name,gstin,pan,phone,email,city,state,state_code,opening_balance,outstanding_balance,credit_limit,is_active,created_at
       FROM customers ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS total FROM customers ${whereSql}`,
      params
    );
    res.json({ data: rows, total: cnt[0].total, page: Number(page), limit: Number(limit) });
  } catch (e) {
    next(e);
  }
}

async function get(req, res, next) {
  try {
    const [rows] = await getPool().query(
      'SELECT * FROM customers WHERE id=?', [Number(req.params.id)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Customer not found.' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
}

async function nextCode(pool) {
  const [r] = await pool.query('SELECT MAX(id) AS mx FROM customers');
  const next = (r[0].mx || 0) + 1;
  return `CUST-${pad(next, 4)}`;
}

async function create(req, res, next) {
  try {
    const {
      name, company_name, gstin, pan, phone, email, address_line1, address_line2,
      city, state, state_code, pincode, opening_balance, credit_limit, is_active,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (gstin && !isValidGstin(gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format.' });
    }
    // Optional: verify state code matches GSTIN prefix
    if (gstin && state_code && String(gstin).slice(0, 2) !== String(state_code)) {
      return res.status(400).json({ error: 'State code does not match GSTIN prefix.' });
    }
    const pool = getPool();
    const customer_code = await nextCode(pool);
    const [r] = await pool.query(
      `INSERT INTO customers
       (customer_code,name,company_name,gstin,pan,phone,email,address_line1,address_line2,state,state_code,city,pincode,opening_balance,credit_limit,is_active,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        customer_code, name, company_name || null, gstin || null, pan || null, phone || null, email || null,
        address_line1 || null, address_line2 || null, state || null, state_code || null, city || null,
        pincode || null, Number(opening_balance) || 0, credit_limit || null,
        is_active === undefined ? 1 : is_active ? 1 : 0, req.user.id,
      ]
    );
    await audit(req, 'CREATE', 'customer', r.insertId, { name, gstin: gstin || null });
    res.status(201).json({ id: r.insertId, customer_code, message: 'Customer created.' });
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (b.gstin && !isValidGstin(b.gstin)) {
      return res.status(400).json({ error: 'Invalid GSTIN format.' });
    }
    const pool = getPool();
    const fields = ['name','company_name','gstin','pan','phone','email','address_line1','address_line2','state','state_code','city','pincode','credit_limit'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(b[f]);
      }
    }
    if (b.opening_balance !== undefined) { sets.push('opening_balance=?'); params.push(Number(b.opening_balance)); }
    if (b.is_active !== undefined) { sets.push('is_active=?'); params.push(b.is_active ? 1 : 0); }
    if (!sets.length) return res.status(400).json({ error: 'Nothing to update.' });
    params.push(id);
    await pool.query(`UPDATE customers SET ${sets.join(', ')} WHERE id=?`, params);
    await audit(req, 'UPDATE', 'customer', id, { fields: Object.fromEntries(fields.filter((f) => b[f] !== undefined).map((f) => [f, b[f]])) });
    res.json({ message: 'Customer updated.' });
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const [c] = await getPool().query('SELECT name FROM customers WHERE id=?', [Number(req.params.id)]);
    const [[ref]] = await getPool().query(
      `SELECT (SELECT COUNT(*) FROM invoices WHERE customer_id=?) + (SELECT COUNT(*) FROM payments WHERE customer_id=?) AS refs`,
      [Number(req.params.id), Number(req.params.id)]
    );
    const refs = Number(ref && ref.refs) || 0;
    if (refs > 0) {
      await getPool().query('UPDATE customers SET is_active=0 WHERE id=?', [Number(req.params.id)]);
      await audit(req, 'DEACTIVATE', 'customer', Number(req.params.id), { name: c[0]?.name || null });
      return res.json({ message: 'Customer has transactions - deactivated instead of deleted.', deactivated: true });
    }
    const [r] = await getPool().query('DELETE FROM customers WHERE id=?', [Number(req.params.id)]);
    if (!r.affectedRows) return res.status(404).json({ error: 'Customer not found.' });
    await audit(req, 'DELETE', 'customer', Number(req.params.id), { name: c[0]?.name || null });
    res.json({ message: 'Customer deleted.' });
  } catch (e) {
    next(e);
  }
}

module.exports = { list, get, create, update, remove };