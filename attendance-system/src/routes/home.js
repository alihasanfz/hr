const express = require('express');
const db = require('../db/pool');
const config = require('../config');
const { requireAuth, requireRole } = require('../middleware/auth');
const { todaySnapshot, trend, monthData } = require('../lib/dashboard');
const { nowLocal } = require('../lib/time');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  if (req.user.role === 'staff') {
    const now = nowLocal();
    let data = null; let today = null;
    if (req.user.employee_id) {
      data = await monthData(req.user.employee_id, now.date.slice(0, 7));
      today = data.rows.find((r) => r.date === now.date) || null;
    }
    return res.render('staff-home', { title: 'My day', now, data, today });
  }
  return res.render('dashboard', { title: 'Overview', snap: await todaySnapshot() });
});

const staffOnlyApi = [requireAuth, requireRole('admin', 'hr')];
router.get('/api/dashboard/live', staffOnlyApi, async (req, res) => res.json(await todaySnapshot()));
router.get('/api/dashboard/trend', staffOnlyApi, async (req, res) => res.json(await trend(7)));

router.get('/api/push/key', requireAuth, (req, res) => res.json({ key: config.vapid.publicKey || null }));
router.post('/api/push/subscribe', staffOnlyApi, async (req, res) => {
  const s = req.body || {};
  if (!s.endpoint || !s.keys || !s.keys.p256dh || !s.keys.auth) return res.status(400).json({ error: 'Invalid subscription' });
  await db.query(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth]
  );
  res.json({ ok: true });
});

module.exports = router;
