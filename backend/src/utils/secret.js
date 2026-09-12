const dotenv = require('dotenv');

dotenv.config();

const KNOWN_DEFAULT = 'dev-insecure-secret-change-me';
const KNOWN_WEAK = new Set([
  KNOWN_DEFAULT,
  'change-this-to-a-long-random-string',
  'changeme',
  'secret',
  'password',
  'your-256-bit-secret',
]);

function isProduction() {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function isWeak(secret) {
  return KNOWN_WEAK.has(secret.toLowerCase()) || secret.length < 16;
}

/**
 * Single source of truth for the JWT signing/verification secret.
 * Security guard: in production the app refuses to start (fail-closed) if the
 * secret is missing, a known placeholder, or shorter than 16 characters. In
 * development the old fallback is kept so local installs never break, but a
 * loud warning is printed.
 */
function getJwtSecret() {
  const raw = String(process.env.JWT_SECRET || '').trim();
  if (!raw || isWeak(raw)) {
    if (isProduction()) {
      console.error(
        '[FATAL] JWT_SECRET is missing or set to a known insecure/placeholder value. ' +
        'Generate a strong random secret (e.g. node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))") ' +
        'and set it in backend/.env to start in production.'
      );
      process.exit(1);
    }
    console.warn(
      '[SECURITY] JWT_SECRET is missing or set to a known insecure/placeholder value. ' +
      'Generate a strong random secret before going live.'
    );
    return raw || KNOWN_DEFAULT;
  }
  return raw;
}

module.exports = { getJwtSecret, isProduction };