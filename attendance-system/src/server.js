const config = require('./config');
const migrate = require('./db/migrate');
const scheduler = require('./jobs/scheduler');

async function main() {
  if (config.autoMigrate) await migrate();
  const boot = await require('./lib/bootstrap').ensureFirstAdmin();
  console.log(boot.message);
  const app = require('./app');
  app.listen(config.port, () => console.log(`Attendance system listening on port ${config.port}`));
  scheduler.start();
}

main().catch((e) => { console.error('Failed to start:', e); process.exit(1); });
