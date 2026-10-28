const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db/pool');
const config = require('../config');
const audit = require('../lib/audit');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => res.status(429).render('login', { title: 'Sign in', error: 'Too many attempts. Try again in a few minutes.' }),
});

router.get('/login', (req, res) => (req.user ? res.redirect('/') : res.render('login', { title: 'Sign in', error: null })));

router.post('/login', limiter, async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const { rows: [u] } = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  const ok = u && u.active && (await bcrypt.compare(String(req.body.password || ''), u.password_hash));
  if (!ok) return res.status(401).render('login', { title: 'Sign in', error: 'Wrong username or password.' });
  await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id]);
  const token = jwt.sign({ id: u.id }, config.jwtSecret, { expiresIn: '8h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: config.env === 'production', maxAge: 8 * 3600 * 1000 });
  return res.redirect('/');
});

router.post('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/login'); });

router.get('/profile', requireAuth, (req, res) => res.render('profile', { title: 'Profile', ok: req.query.ok, err: req.query.err }));

router.post('/profile/password', requireAuth, async (req, res) => {
  const { current, next, confirm } = req.body;
  const { rows: [u] } = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) return res.redirect('/profile?err=Current password is incorrect.');
  if (String(next || '').length < 8) return res.redirect('/profile?err=New password must be at least 8 characters.');
  if (next !== confirm) return res.redirect('/profile?err=New passwords do not match.');
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 10), req.user.id]);
  await audit.log(req, 'password.change', 'user', req.user.id);
  return res.redirect('/profile?ok=Password updated.');
});

module.exports = router;
