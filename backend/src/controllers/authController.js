const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { getPool } = require('../db');
const { isValidGstin } = require('../utils/gst');
const { pad } = require('../utils/helpers');

dotenv.config();
const JWT_SECRET = process.env.JWT_SECRET;

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const pool = getPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE email=? AND is_active=1', [email]);
    if (!rows.length) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    await pool.query('UPDATE users SET last_login_at=NOW() WHERE id=?', [user.id]);
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name, role: user.role },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (e) {
    next(e);
  }
}

async function me(req, res, next) {
  try {
    const pool = getPool();
    const [rows] = await pool.query(
      'SELECT id,name,email,phone,role,created_at FROM users WHERE id=?',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
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
    res.json({ message: 'Password updated.' });
  } catch (e) {
    next(e);
  }
}

// ---------- User management (super admin) ----------
async function listUsers(req, res, next) {
  try {
    const [rows] = await getPool().query(
      'SELECT id,name,email,phone,role,is_active,last_login_at,created_at FROM users ORDER BY id'
    );
    res.json(rows);
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
    const roles = ['ADMIN', 'ACCOUNTANT', 'SALES', 'STORE'];
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
    const { name, phone, role, is_active } = req.body || {};
    const id = Number(req.params.id);
    const pool = getPool();
    await pool.query(
      'UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role), is_active=COALESCE(?,is_active) WHERE id=?',
      [name || null, phone || null, role || null, is_active === undefined ? null : is_active ? 1 : 0, id]
    );
    res.json({ message: 'User updated.' });
  } catch (e) {
    next(e);
  }
}

async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself.' });
    const [r] = await getPool().query('DELETE FROM users WHERE id=?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: 'User not found.' });
    res.json({ message: 'User deleted.' });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  login,
  me,
  changePassword,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
};