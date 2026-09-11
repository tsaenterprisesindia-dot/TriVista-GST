const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';

/**
 * Verify the Bearer token and attach req.user
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role,
    };
    // Terms-of-service gate: block access until the user has accepted them.
    const TERMS_WHITELIST = [
      '/api/auth/login',
      '/api/auth/me',
      '/api/auth/accept-terms',
      '/api/health',
    ];
    const cleanUrl = String(req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
    if (payload.terms !== true && !TERMS_WHITELIST.includes(cleanUrl)) {
      return res.status(403).json({ error: 'You must accept the Terms of Service before using the application.', code: 'TERMS_REQUIRED' });
    }
    // VIEWER accounts are otherwise read-only, but may submit support messages.
    const viewerFeedbackSubmit =
      req.method === 'POST' && req.originalUrl.replace(/\/+$/, '') === '/api/feedback';
    if (
      req.user.role === 'VIEWER' &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !viewerFeedbackSubmit
    ) {
      return res.status(403).json({ error: 'Viewer accounts are read-only and cannot modify data.' });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token. Please log in again.' });
  }
}

/**
 * Restrict an endpoint to given roles.
 * Usage: authorize('ADMIN', 'ACCOUNTANT')
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' });
    }
    next();
  };
}

function requireSuperAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
  if (req.user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Super admin access required.' });
  }
  next();
}

module.exports = { authenticate, authorize, requireSuperAdmin };