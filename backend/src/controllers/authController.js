const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');
const { audit } = require('../utils/audit');
const { getJwtSecret } = require('../utils/secret');

dotenv.config();
const JWT_SECRET = getJwtSecret();

// Login lockout: 5 consecutive failures per email+IP -> 15 minutes.
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MINUTES = 15;
const loginAttempts = new Map();

function loginKey(email, ip) {
  return `${String(email).toLowerCase().trim()}|${ip || ''}`;
}

function isLocked(key) {
  const rec = loginAttempts.get(key);
  if (!rec) return null;
  if (rec.count >= LOGIN_MAX_ATTEMPTS && Date.now() < rec.lockedUntil) return rec.lockedUntil;
  if (Date.now() >= rec.lockedUntil && rec.count >= LOGIN_MAX_ATTEMPTS) {
    // Lock expired -> reset counter.
    loginAttempts.delete(key);
    return null;
  }
  return null;
}

function recordFailure(key) {
  const rec = loginAttempts.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOGIN_LOCK_MINUTES * 60 * 1000;
  }
  loginAttempts.set(key, rec);
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const ip = String(req.ip || req.connection?.remoteAddress || '');
    const key = loginKey(email, ip);
    const lockedUntil = isLocked(key);
    if (lockedUntil) {
      const mins = Math.ceil((lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} min.` });
    }

    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE email=? AND is_active=1', [email]);
    if (!rows.length) {
      recordFailure(key);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      recordFailure(key);
      await audit(req, 'LOGIN_FAIL', 'user', user.id, { email });
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    // Success -> clear any failure record.
    loginAttempts.delete(key);
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=?', [user.id]);
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role, terms: !!user.accepted_terms_at },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
    await audit(req, 'LOGIN', 'user', user.id, { email });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, terms_accepted: !!user.accepted_terms_at },
    });
  } catch (e) {
    next(e);
  }
}

async function me(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id,name,email,phone,role,is_active,last_login_at,created_at,accepted_terms_at FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const u = rows[0];
    res.json({ ...u, terms_accepted: !!u.accepted_terms_at });
  } catch (e) {
    next(e);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords are required.' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE id=?', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const ok = await bcrypt.compare(currentPassword, rows[0].password_hash);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
    await audit(req, 'CHANGE_PASSWORD', 'user', req.user.id, {});
    res.json({ message: 'Password updated.' });
  } catch (e) {
    next(e);
  }
}

// ---------- User management (super admin) ----------
async function listUsers(req, res, next) {
  try {
    const [rows] = await getPool().query(
      'SELECT id,name,email,phone,role,is_active,last_login_at,created_at,accepted_terms_at FROM users ORDER BY id'
    );
    res.json(rows.map((r) => ({ ...r, terms_accepted: !!r.accepted_terms_at })));
  } catch (e) {
    next(e);
  }
}

async function createUser(req, res, next) {
  try {
    const { name, email, password, phone, role } = req.body || {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email and password are required.' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    const roles = ['ADMIN', 'ACCOUNTANT', 'SALES', 'STORE', 'VIEWER'];
    if (!roles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    const hash = await bcrypt.hash(password, 10);
    const pool = getPool();
    try {
      const [r] = await pool.query(
        'INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)',
        [name, email, phone || null, hash, role]
      );
      await audit(req, 'CREATE', 'user', r.insertId, { name, email, role });
      res.status(201).json({ id: r.insertId, message: 'User created.' });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already exists.' });
      throw e;
    }
  } catch (e) {
    next(e);
  }
}

async function updateUser(req, res, next) {
  try {
    const { name, phone, role, is_active, password } = req.body || {};
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Invalid user id.' });
    }
    const pool = getPool();

    // Fetch target user
    const [targetRows] = await pool.query('SELECT id,role FROM users WHERE id=?', [id]);
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });
    const target = targetRows[0];

    // Prevent the super admin from demoting themselves
    if (id === req.user.id && role && role !== 'SUPER_ADMIN') {
      return res.status(400).json({ error: 'You cannot change your own role.' });
    }

    // Prevent the super admin from deactivating themselves
    if (id === req.user.id && is_active === false) {
      return res.status(400).json({ error: 'You cannot deactivate yourself.' });
    }

    // Prevent demoting the last super admin
    if (role && role !== 'SUPER_ADMIN' && target.role === 'SUPER_ADMIN') {
      const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role='SUPER_ADMIN'");
      if (cnt <= 1) {
        return res.status(400).json({ error: 'Cannot demote the last super admin.' });
      }
    }

    let hash = null;
    if (password !== undefined && password !== null && String(password) !== '') {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      hash = await bcrypt.hash(String(password), 10);
    }
    await pool.query(
      'UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role), is_active=COALESCE(?,is_active), password_hash=COALESCE(?,password_hash) WHERE id=?',
      [name || null, phone || null, role || null, is_active === undefined ? null : is_active ? 1 : 0, hash, id]
    );
    await audit(req, 'UPDATE', 'user', id, { name: name || null, phone: phone || null, role: role || null, is_active: is_active === undefined ? null : is_active ? 1 : 0, password_reset: !!hash });
    res.json({ message: 'User updated.' });
  } catch (e) {
    next(e);
  }
}

async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself.' });
    const pool = getPool();

    const [targetRows] = await pool.query('SELECT id,role FROM users WHERE id=?', [id]);
    if (!targetRows.length) return res.status(404).json({ error: 'User not found.' });

    // Prevent deleting the last super admin
    if (targetRows[0].role === 'SUPER_ADMIN') {
      const [[{ cnt }]] = await pool.query("SELECT COUNT(*) AS cnt FROM users WHERE role='SUPER_ADMIN'");
      if (cnt <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last super admin.' });
      }
    }

    await pool.query('DELETE FROM users WHERE id=?', [id]);
    await audit(req, 'DELETE', 'user', id, {});
    res.json({ message: 'User deleted.' });
  } catch (e) {
    next(e);
  }
}

async function acceptTerms(req, res, next) {
  try {
    const pool = getPool();
    await pool.query("UPDATE users SET accepted_terms_at = IFNULL(accepted_terms_at, NOW()) WHERE id=?", [req.user.id]);
    const [rows] = await pool.query("SELECT id,name,email,role FROM users WHERE id=?", [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const u = rows[0];
    const token = jwt.sign(
      { id: u.id, email: u.email, name: u.name, role: u.role, terms: true },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
    await audit(req, 'ACCEPT_TERMS', 'user', req.user.id, {});
    res.json({ token, user: { ...u, terms_accepted: true } });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  login,
  me,
  changePassword,
  acceptTerms,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};