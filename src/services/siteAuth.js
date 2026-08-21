const crypto = require('node:crypto');

const COOKIE_NAME = 'aiads_access';
const DAY = 24 * 60 * 60 * 1000;

const parseCookies = header => Object.fromEntries(String(header || '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const index = part.indexOf('=');
  return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
}));

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signingKey(secret, password) {
  return crypto.createHash('sha256').update(`${secret}\0${password}`).digest();
}

function signToken(payload, secret, password) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey(secret, password)).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token, { username, password, secret }, now = Date.now()) {
  try {
    const [encoded, signature, extra] = String(token || '').split('.');
    if (!encoded || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', signingKey(secret, password)).update(encoded).digest('base64url');
    if (!secureEqual(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (payload?.u !== username || !Number.isFinite(payload?.exp) || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSiteAuth({ enabled = false, username = '', password = '', secret = '', days = 180 } = {}) {
  const ttlMs = Math.max(1, Math.min(365, Number(days) || 180)) * DAY;
  const config = { username: String(username || ''), password: String(password || ''), secret: String(secret || '') };
  const configured = Boolean(config.username && config.password && config.secret);

  const cookieOptions = req => ({
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure),
    path: '/',
    maxAge: ttlMs
  });

  const issue = (req, res) => {
    const now = Date.now();
    const token = signToken({ u: config.username, iat: now, exp: now + ttlMs }, config.secret, config.password);
    res.cookie(COOKIE_NAME, token, cookieOptions(req));
    return token;
  };

  const clear = (req, res) => res.clearCookie(COOKIE_NAME, { ...cookieOptions(req), maxAge: undefined });
  const tokenFrom = req => parseCookies(req.headers.cookie)[COOKIE_NAME] || '';
  const payloadFrom = req => configured ? verifyToken(tokenFrom(req), config) : null;
  const authenticated = req => !enabled || Boolean(payloadFrom(req));
  const credentialsMatch = (user, pass) => configured && secureEqual(user, config.username) && secureEqual(pass, config.password);

  const publicPath = path => path === '/login'
    || path === '/api/auth/login'
    || path === '/api/auth/status'
    || path === '/api/auth/check'
    || path === '/terms'
    || path === '/privacy'
    || path.startsWith('/auth/tiktok/callback')
    || path.startsWith('/generated/')
    || path.startsWith('/.well-known/');

  const requireAuth = (req, res, next) => {
    if (!enabled || publicPath(req.path)) return next();
    if (!configured) return res.status(503).json({ error: 'Login AI Ads Lab belum dikonfigurasi di server.' });
    const payload = payloadFrom(req);
    if (payload) {
      const remaining = payload.exp - Date.now();
      if (remaining < ttlMs / 2) issue(req, res);
      return next();
    }
    if (req.path.startsWith('/api/') || req.method !== 'GET') return res.status(401).json({ error: 'Sesi login berakhir. Buka /login untuk masuk kembali.' });
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(302, `/login?next=${nextUrl}`);
  };

  return {
    enabled: Boolean(enabled),
    configured,
    ttlMs,
    credentialsMatch,
    authenticated,
    payloadFrom,
    issue,
    clear,
    requireAuth,
    publicPath
  };
}

module.exports = { COOKIE_NAME, createSiteAuth, parseCookies, signToken, verifyToken, secureEqual };
