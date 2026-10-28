const cron = require('node-cron');
const config = require('../config');
const { computeAll } = require('../lib/attendanceEngine');
const { nowLocal, addDays } = require('../lib/time');

// Every 15 minutes: close finished shifts so absences, missing check-outs and early departures
// raise their alerts even when no one punches. Alerts are de-duplicated per employee and day.
function start() {
  cron.schedule('*/15 * * * *', async () => {
    try {
      const today = nowLocal().date;
      await computeAll(addDays(today, -1));
      await computeAll(today);
    } catch (e) {
      console.error('Attendance close job failed:', e.message);
    }
  }, { timezone: config.tz });
  console.log('Scheduler started (every 15 minutes).');
}

module.exports = { start };
