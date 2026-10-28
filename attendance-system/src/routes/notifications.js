const express = require('express');
const db = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'hr'));

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT n.id, n.kind, n.title, n.body, n.is_read, n.created_at, n.work_date::text AS work_date, e.full_name
       FROM notifications n LEFT JOIN employees e ON e.id = n.employee_id ORDER BY n.id DESC LIMIT 100`
  );
  res.render('notifications', { title: 'Alerts', rows });
});

router.post('/read-all', async (req, res) => {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE NOT is_read');
  res.redirect('/notifications');
});

router.post('/:id/read', async (req, res) => {
  await db.query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [req.params.id]);
  res.redirect('/notifications');
});

module.exports = router;
