const jwt = require('jsonwebtoken');
const db = require('../db/pool');
const config = require('../config');

async function attachUser(req, res, next) {
  req.user = null;
  res.locals.user = null;
  const token = req.cookies && req.cookies.token;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret);
      const { rows: [u] } = await db.query(
        `SELECT u.id, u.username, u.role, u.active, e.id AS employee_id, e.full_name
           FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = $1`,
        [payload.id]
      );
      if (u && u.active) {
        req.user = u;
        res.locals.user = u;
        if (u.role !== 'staff') {
          const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM notifications WHERE NOT is_read');
          res.locals.unread = c.n;
        }
      }
    } catch (e) { /* invalid or expired token: treated as signed out */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required' });
  return res.redirect('/login');
}

const requireRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  if (!req.user) return res.redirect('/login');
  return res.status(403).render('error', { title: 'No access', code: 403, message: 'Your role does not have access to this page.' });
};

// Rejects cross-site form posts: the Origin header, when present, must match this host.
function sameOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== 'null') {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).send('Cross-site request blocked.');
    } catch (e) { return res.status(403).send('Bad origin.'); }
  }
  return next();
}

module.exports = { attachUser, requireAuth, requireRole, sameOrigin };
