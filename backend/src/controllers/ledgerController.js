const { getPool } = require('../db');
const { audit } = require('../utils/audit');
const { pad } = require('../utils/helpers');
const L = require('../utils/ledger');

const TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'];

// ---------------- Chart of Accounts ----------------

async function listAccounts(req, res, next) {
  try {
    const rows = await L.accountList(getPool());
    res.json({ data: rows });
  } catch (e) {
    next(e);
  }
}

async function createAccount(req, res, next) {
  try {
    const pool = getPool();
    const b = req.body || {};
    const code = String(b.code || '').trim();
    const name = String(b.name || '').trim();
    const type = String(b.type || '').toUpperCase();
    if (!code) return res.status(400).json({ error: 'Account code is required.' });
    if (!name) return res.status(400).json({ error: 'Account name is required.' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Account type must be one of ' + TYPES.join(', ') + '.' });

    const parentId = b.parent_id ? Number(b.parent_id) : null;
    if (parentId) {
      const [p] = await pool.query('SELECT id FROM accounts WHERE id=?', [parentId]);
      if (!p.length) return res.status(400).json({ error: 'Parent account not found.' });
    }

    const [ins] = await pool.query(
      'INSERT INTO accounts (code,name,type,parent_id,opening_balance,is_active) VALUES (?,?,?,?,?,?)',
      [code, name, type, parentId, Number(b.opening_balance) || 0, Number(b.is_active) === 0 ? 0 : 1]
    );
    await audit(req, 'CREATE', 'account', ins.insertId, { code, name, type });
    res.status(201).json({ id: ins.insertId, message: 'Account created.' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Account code already exists.' });
    next(e);
  }
}

async function updateAccount(req, res, next) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT * FROM accounts WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });
    const acct = rows[0];

    const b = req.body || {};
    const code = b.code !== undefined ? String(b.code).trim() : acct.code;
    const name = b.name !== undefined ? String(b.name).trim() : acct.name;
    const type = b.type !== undefined ? String(b.type).toUpperCase() : acct.type;
    if (!code || !name) return res.status(400).json({ error: 'Account code and name are required.' });
    if (!TYPES.includes(type)) return res.status(400).json({ error: 'Invalid account type.' });

    const opening = b.opening_balance !== undefined ? Number(b.opening_balance) : Number(acct.opening_balance);
    const newOpening = Number(opening) || 0;
    if (Math.abs(newOpening - Number(acct.opening_balance)) > 0.005) {
      const [tx] = await pool.query('SELECT COUNT(*) AS n FROM transactions WHERE account_id=?', [id]);
      if (Number(tx[0].n) > 0) {
        return res.status(400).json({ error: 'Opening balance cannot be changed once the account has ledger postings.' });
      }
    }
    const parentId = b.parent_id !== undefined ? (b.parent_id ? Number(b.parent_id) : null) : acct.parent_id;
    const isActive = b.is_active !== undefined ? (Number(b.is_active) === 0 ? 0 : 1) : Number(acct.is_active);

    await pool.query(
      'UPDATE accounts SET code=?, name=?, type=?, parent_id=?, opening_balance=?, is_active=? WHERE id=?',
      [code, name, type, parentId, newOpening, isActive, id]
    );
    await audit(req, 'UPDATE', 'account', id, { code, name, type });
    res.json({ message: 'Account updated.' });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Account code already exists.' });
    next(e);
  }
}

async function deleteAccount(req, res, next) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT * FROM accounts WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Account not found.' });

    const [tx] = await pool.query('SELECT COUNT(*) AS n FROM transactions WHERE account_id=?', [id]);
    if (Number(tx[0].n) > 0) {
      return res.status(400).json({ error: 'Account has ledger postings and cannot be deleted. Deactivate it instead.' });
    }
    const [ch] = await pool.query('SELECT COUNT(*) AS n FROM accounts WHERE parent_id=?', [id]);
    if (Number(ch[0].n) > 0) {
      return res.status(400).json({ error: 'Account has child accounts and cannot be deleted.' });
    }

    await pool.query('DELETE FROM accounts WHERE id=?', [id]);
    await audit(req, 'DELETE', 'account', id, {});
    res.json({ message: 'Account deleted.' });
  } catch (e) {
    next(e);
  }
}

// ---------------- Reports ----------------

async function ledger(req, res, next) {
  try {
    const id = Number(req.query.account_id);
    if (!id) return res.status(400).json({ error: 'account_id is required.' });
    const report = await L.ledgerReport(getPool(), {
      account_id: id,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json(report);
  } catch (e) {
    next(e);
  }
}

async function trialBalance(req, res, next) {
  try {
    const apiPool = getPool();
    let report;
    if (req.query.asof) report = await L.trialBalanceReport(apiPool, req.query.asof);
    else report = await L.trialBalanceReport(apiPool);
    res.json(report);
  } catch (e) {
    next(e);
  }
}

async function cashBank(req, res, next) {
  try {
    const apiPool = getPool();
    const id = Number(req.query.account_id) || (await L.accountId(apiPool, '1000'));
    const report = await L.ledgerReport(apiPool, {
      account_id: id,
      from: req.query.from || undefined,
      to: req.query.to || undefined,
    });
    res.json(report);
  } catch (e) {
    next(e);
  }
}

// ---------------- Journal (manual vouchers) ----------------

async function listJournal(req, res, next) {
  try {
    const pool = getPool();
    const where = [];
    const params = [];
    if (req.query.from) where.push('j.voucher_date >= ?'), params.push(req.query.from);
    if (req.query.to) where.push('j.voucher_date <= ?'), params.push(req.query.to);
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const [entries] = await pool.query(
      `SELECT j.*, u.name AS created_by_name
       FROM journal_entries j LEFT JOIN users u ON u.id = j.created_by
       ${whereSql} ORDER BY j.voucher_date DESC, j.id DESC LIMIT 500`,
      params
    );
    if (!entries.length) return res.json({ data: [] });

    const ids = entries.map((e) => e.id);
    const [legs] = await pool.query(
      `SELECT t.journal_id, t.voucher_no, t.account_id, t.\`date\`, t.debit, t.credit, t.narration,
              a.code AS account_code, a.name AS account_name
       FROM transactions t JOIN accounts a ON a.id = t.account_id
       WHERE t.journal_id IN (?) ORDER BY t.id`,
      [ids]
    );
    const legsByJournal = {};
    for (const l of legs) {
      (legsByJournal[l.journal_id] = legsByJournal[l.journal_id] || []).push({
        account_id: l.account_id,
        account_code: l.account_code,
        account_name: l.account_name,
        debit: l.debit,
        credit: l.credit,
      });
    }
    res.json({ data: entries.map((e) => ({ ...e, legs: legsByJournal[e.id] || [] })) });
  } catch (e) {
    next(e);
  }
}

async function createJournal(req, res, next) {
  try {
    const pool = getPool();
    const b = req.body || {};
    const date = b.date || new Date().toISOString().slice(0, 10);
    const narration = String(b.narration || '').trim() || 'Journal entry';
    if (!Array.isArray(b.entries) || !b.entries.length) {
      return res.status(400).json({ error: 'At least one ledger line is required.' });
    }

    const [nx] = await pool.query(
      "SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(voucher_no, '-', -1) AS UNSIGNED)), 0) + 1 AS n FROM journal_entries WHERE source = 'JOURNAL'"
    );
    const voucherNo = `JV-${pad(Number(nx[0].n), 6)}`;

    const legs = [];
    for (const e of b.entries) {
      const aid = Number(e.account_id);
      if (!aid) return res.status(400).json({ error: 'Each line needs an account_id.' });
      const [a] = await pool.query('SELECT id, is_active FROM accounts WHERE id=?', [aid]);
      if (!a.length) return res.status(400).json({ error: `Account ${aid} not found.` });
      if (Number(a[0].is_active) === 0) return res.status(400).json({ error: `Account ${aid} is inactive.` });
      const debit = Number(e.debit) || 0;
      const credit = Number(e.credit) || 0;
      if (debit === 0 && credit === 0) return res.status(400).json({ error: 'Each line needs a debit or credit amount.' });
      legs.push({ account_id: aid, debit, credit });
    }

    const result = await L.postVoucher(pool, {
      voucher_no: voucherNo,
      date,
      narration,
      source: 'JOURNAL',
      legs,
      created_by: req.user.id,
    });
    await audit(req, 'CREATE', 'journal_voucher', result.id, { voucher_no: voucherNo, narration });
    res.status(201).json({ id: result.id, voucher_no: voucherNo, message: 'Journal voucher posted.' });
  } catch (e) {
    next(e);
  }
}

async function deleteJournal(req, res, next) {
  try {
    const pool = getPool();
    const id = Number(req.params.id);
    const [rows] = await pool.query('SELECT * FROM journal_entries WHERE id=?', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Journal voucher not found.' });
    if (rows[0].source !== 'JOURNAL') {
      return res.status(400).json({ error: 'Only manual journal vouchers can be deleted.' });
    }
    if (rows[0].status === 'VOID') return res.status(400).json({ error: 'Voucher is already void.' });

    const [rev] = await pool.query('SELECT id FROM journal_entries WHERE voucher_no=?', [`REV-${rows[0].voucher_no}`]);
    if (rev.length) return res.status(400).json({ error: 'Voucher has a reversal - delete that first.' });

    await pool.query('UPDATE journal_entries SET status=? WHERE id=?', ['VOID', id]);
    await pool.query('DELETE FROM transactions WHERE journal_id=?', [id]);
    await audit(req, 'DELETE', 'journal_voucher', id, { voucher_no: rows[0].voucher_no });
    res.json({ message: 'Journal voucher voided.' });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  ledger,
  trialBalance,
  cashBank,
  listJournal,
  createJournal,
  deleteJournal,
};