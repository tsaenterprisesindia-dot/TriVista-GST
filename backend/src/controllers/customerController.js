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
      `SELECT id,customer_code,name,legal_name,company_name,gstin,registration_category,tax_exempt,pan,phone,email,address_line1,address_line2,city,state,state_code,pincode,opening_balance,outstanding_balance,credit_limit,points_balance,tds_rate,tcs_rate,tds_threshold,tcs_threshold,is_active,created_at
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

const CATEGORIES = ['registered', 'unregistered', 'composition', 'sez', 'export'];

const cleanCat = (v) => (CATEGORIES.includes(v) ? v : null);

async function create(req, res, next) {
  try {
    const {
      name, legal_name, company_name, gstin, registration_category, tax_exempt, pan, phone, email, address_line1, address_line2,
      city, state, state_code, pincode, opening_balance, credit_limit, tds_rate, tcs_rate, tds_threshold, tcs_threshold, is_active,
    } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    if (!legal_name) return res.status(400).json({ error: 'Legal name is required.' });
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
       (customer_code,name,legal_name,company_name,gstin,registration_category,tax_exempt,pan,phone,email,address_line1,address_line2,state,state_code,city,pincode,opening_balance,credit_limit,tds_rate,tcs_rate,tds_threshold,tcs_threshold,is_active,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        customer_code, name, legal_name, company_name || null, gstin || null, cleanCat(registration_category), tax_exempt ? 1 : 0,
        pan || null, phone || null, email || null, address_line1 || null, address_line2 || null, state || null,
        state_code || null, city || null, pincode || null, Number(opening_balance) || 0, credit_limit || null,
        tds_rate == null ? null : Number(tds_rate), tcs_rate == null ? null : Number(tcs_rate),
        tds_threshold == null ? null : Number(tds_threshold), tcs_threshold == null ? null : Number(tcs_threshold),
        is_active === undefined ? 1 : is_active ? 1 : 0, req.user.id,
      ]
    );
    await audit(req, 'CREATE', 'customer', r.insertId, { name, legal_name, gstin: gstin || null, registration_category: cleanCat(registration_category) });
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
    const fields = ['name','legal_name','company_name','gstin','pan','phone','email','address_line1','address_line2','state','state_code','city','pincode','credit_limit'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (b[f] !== undefined) {
        sets.push(`${f}=?`);
        params.push(b[f]);
      }
    }
    if (b.registration_category !== undefined) { sets.push('registration_category=?'); params.push(cleanCat(b.registration_category)); }
    if (b.tax_exempt !== undefined) { sets.push('tax_exempt=?'); params.push(b.tax_exempt ? 1 : 0); }
    for (const f of ['tds_rate','tcs_rate','tds_threshold','tcs_threshold']) {
      if (b[f] !== undefined) {
        if (b[f] === '' || b[f] == null) sets.push(`${f}=NULL`);
        else { sets.push(`${f}=?`); params.push(Number(b[f])); }
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

async function history(req, res, next) {
  try {
    const id = Number(req.params.id);
    const pool = getPool();
    const [cust] = await pool.query('SELECT * FROM customers WHERE id=?', [id]);
    if (!cust.length) return res.status(404).json({ error: 'Customer not found.' });

    const [sum] = await pool.query(
      `SELECT
         COUNT(*) AS invoice_count,
         IFNULL(SUM(subtotal),0) AS total_sales,
         IFNULL(SUM(tax_total),0) AS total_gst,
         IFNULL(SUM(grand_total),0) AS total_billed,
         IFNULL(SUM(paid_amount),0) AS total_paid,
         IFNULL(SUM(balance_due),0) AS total_due,
         MIN(invoice_date) AS first_invoice_date,
         MAX(invoice_date) AS last_invoice_date
       FROM invoices WHERE customer_id=? AND status<>'CANCELLED'`,
      [id]
    );

    const [invoices] = await pool.query(
      `SELECT id,invoice_number,invoice_date,invoice_type,status,is_interstate,subtotal,discount,
              cgst_total,sgst_total,utgst_total,igst_total,cess_total,tax_total,round_off,grand_total,
              paid_amount,balance_due,payment_mode,tcs_amount,notes,created_at,against_invoice_no
       FROM invoices WHERE customer_id=? ORDER BY invoice_date DESC, id DESC
       LIMIT 500`,
      [id]
    );

    const [payments] = await pool.query(
      `SELECT id,date,amount,mode,reference_no,note FROM payments
       WHERE customer_id=? ORDER BY date DESC, id DESC LIMIT 500`,
      [id]
    );

    res.json({ customer: cust[0], summary: sum[0], invoices, payments });
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

module.exports = { list, get, create, update, remove, history };