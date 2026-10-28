const bcrypt = require('bcryptjs');
const db = require('../db/pool');

// Creates the very first Admin when the users table is empty.
// Needs ADMIN_USERNAME and ADMIN_PASSWORD in the environment. No default password exists.
async function ensureFirstAdmin() {
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
  if (c.n > 0) return { ok: true, created: false, message: 'Users already exist. Nothing created.' };

  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!username || !password) {
    return { ok: false, created: false, message: 'No users yet. Set ADMIN_USERNAME and ADMIN_PASSWORD to create the first Admin.' };
  }
  if (password.length < 10) {
    return { ok: false, created: false, message: 'ADMIN_PASSWORD must be at least 10 characters.' };
  }
  const hash = await bcrypt.hash(password, 10);
  await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3)', [username, hash, 'admin']);
  return { ok: true, created: true, message: `First Admin "${username}" created.` };
}

module.exports = { ensureFirstAdmin };
