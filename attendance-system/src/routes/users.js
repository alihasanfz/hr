const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const audit = require('../lib/audit');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

const ROLES = ['admin', 'hr', 'staff'];
const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const otherAdmins = async (id) => (await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1", [id || 0])).rows[0].n;

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role, u.active, u.last_login_at, e.id AS employee_id, e.full_name
       FROM users u LEFT JOIN employees e ON e.user_id = u.id ORDER BY u.username`
  );
  res.render('users', { title: 'Users', rows, ok: req.query.ok, err: req.query.err });
});

router.get('/new', (req, res) => res.render('user-form', { title: 'Add user', u: null, err: req.query.err }));

router.get('/:id/edit', async (req, res) => {
  const { rows: [u] } = await db.query(
    'SELECT u.id, u.username, u.role, u.active, e.full_name FROM users u LEFT JOIN employees e ON e.user_id = u.id WHERE u.id = $1', [req.params.id]
  );
  if (!u) return res.status(404).render('error', { title: 'Not found', code: 404, message: 'User not found.' });
  res.render('user-form', { title: 'Edit user', u, err: req.query.err });
});

async function save(req, res, id) {
  const b = req.body;
  const back = id ? `/users/${id}/edit` : '/users/new';
  const username = (clean(b.username) || '').toLowerCase();
  const password = clean(b.password);
  let role = ROLES.includes(b.role) ? b.role : 'staff';
  let active = b.active === 'on';
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.redirect(`${back}?err=Username must be 3 to 40 characters: letters, numbers, dot, dash or underscore.`);
  if (!id && !password) return res.redirect(`${back}?err=Password is required for a new user.`);
  if (password && password.length < 8) return res.redirect(`${back}?err=Password must be at least 8 characters.`);

  try {
    if (id) {
      const { rows: [cur] } = await db.query('SELECT id, role, active FROM users WHERE id = $1', [id]);
      if (!cur) return res.redirect('/users?err=User not found.');
      if (id === req.user.id) { role = 'admin'; active = true; }
      else if (cur.role === 'admin' && (role !== 'admin' || !active) && !(await otherAdmins(id))) {
        return res.redirect(`${back}?err=At least one active Admin must remain.`);
      }
      await db.query('UPDATE users SET username=$1, role=$2, active=$3 WHERE id=$4', [username, role, active, id]);
      if (password) await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(password, 10), id]);
    } else {
      const { rows: [n] } = await db.query('INSERT INTO users (username, password_hash, role, active) VALUES ($1,$2,$3,$4) RETURNING id', [username, await bcrypt.hash(password, 10), role, active]);
      id = n.id;
    }
  } catch (e) {
    if (e.code === '23505') return res.redirect(`${back}?err=That username is already taken.`);
    throw e;
  }
  await audit.log(req, 'user.save', 'user', id, { username, role, active });
  res.redirect(`/users?ok=Saved ${username}.`);
}

router.post('/', (req, res) => save(req, res, null));
router.post('/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.redirect('/users?err=You cannot delete your own account.');
  const { rows: [u] } = await db.query('SELECT id, username, role FROM users WHERE id = $1', [id]);
  if (!u) return res.redirect('/users?err=User not found.');
  if (u.role === 'admin' && !(await otherAdmins(id))) return res.redirect('/users?err=At least one active Admin must remain.');
  await db.query('DELETE FROM users WHERE id = $1', [id]);
  await audit.log(req, 'user.delete', 'user', id, { username: u.username });
  res.redirect(`/users?ok=Deleted ${u.username}. Any linked employee record was kept.`);
});
router.post('/:id', (req, res) => save(req, res, Number(req.params.id)));

module.exports = router;
