const db = require('../db/pool');

const DEFAULTS = { company_name: 'Your Company', duplicate_gap_minutes: '2' };
let cache = null;
let loadedAt = 0;

async function all() {
  if (cache && Date.now() - loadedAt < 60000) return cache;
  const { rows } = await db.query('SELECT key, value FROM settings');
  cache = { ...DEFAULTS };
  rows.forEach((r) => { cache[r.key] = r.value; });
  loadedAt = Date.now();
  return cache;
}

async function set(key, value) {
  await db.query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, String(value)]
  );
  cache = null;
}

module.exports = { all, set };
