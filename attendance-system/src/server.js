const config = require('./config');
const migrate = require('./db/migrate');
const db = require('./db/pool');
const scheduler = require('./jobs/scheduler');

async function main() {
  if (config.autoMigrate) await migrate();
  if (config.seedDemo) {
    const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM users');
    if (c.n === 0) await require('../scripts/seed')();
  }
  const app = require('./app');
  app.listen(config.port, () => console.log(`Attendance system listening on port ${config.port}`));
  scheduler.start();
}

main().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
