// Creates the first Admin user. Safe to run again: it does nothing if any user already exists.
// Usage: ADMIN_USERNAME=youradmin ADMIN_PASSWORD='long-strong-password' node scripts/create-admin.js
const bootstrap = require('../src/lib/bootstrap');
const db = require('../src/db/pool');

(async () => {
  const r = await bootstrap.ensureFirstAdmin();
  console.log(r.message);
  await db.end();
  process.exit(r.ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
