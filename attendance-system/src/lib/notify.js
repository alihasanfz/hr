const webpush = require('web-push');
const db = require('../db/pool');
const config = require('../config');

const pushReady = Boolean(config.vapid.publicKey && config.vapid.privateKey && config.vapid.subject);
if (pushReady) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);

async function push(title, body, url = '/notifications') {
  if (!pushReady) return;
  const { rows } = await db.query(
    `SELECT ps.* FROM push_subscriptions ps JOIN users u ON u.id = ps.user_id
     WHERE u.active AND u.role IN ('admin','hr')`
  );
  await Promise.all(rows.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url })
      );
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
    }
  }));
}

// One alert per kind, employee and day: repeated recalculations never spam Admin/HR.
async function exception(kind, employeeId, date, title, body) {
  const { rows } = await db.query(
    `INSERT INTO notifications (kind, employee_id, work_date, title, body)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (kind, employee_id, work_date) DO NOTHING RETURNING id`,
    [kind, employeeId, date, title, body]
  );
  if (rows.length) await push(title, body);
}

module.exports = { exception, push, pushReady };
