const express = require('express');
const db = require('../db/pool');
const audit = require('../lib/audit');
const settings = require('../lib/settings');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const hrAdmin = [requireAuth, requireRole('admin', 'hr')];
const adminOnly = [requireAuth, requireRole('admin')];
const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.max(0, Math.round(Number(v))) : d);

// ---- Shifts
router.get('/shifts', hrAdmin, async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, s.start_time::text AS st, s.end_time::text AS et, (SELECT COUNT(*)::int FROM employees e WHERE e.shift_id = s.id) AS staff
       FROM shifts s ORDER BY s.name`
  );
  const edit = req.query.edit ? rows.find((r) => String(r.id) === String(req.query.edit)) : null;
  res.render('shifts', { title: 'Shifts', rows, edit, ok: req.query.ok, err: req.query.err });
});

router.post('/shifts', hrAdmin, async (req, res) => {
  const b = req.body;
  const off = [].concat(b.weekly_off || []).map(Number).filter((n) => n >= 0 && n <= 6);
  const vals = [clean(b.name), b.start_time, b.end_time, int(b.grace_minutes, 10), int(b.early_out_grace_minutes, 0), int(b.overtime_after_minutes, 30), off];
  if (!vals[0] || !vals[1] || !vals[2]) return res.redirect('/shifts?err=Name, start and end time are required.');
  if (vals[2] <= vals[1]) return res.redirect('/shifts?err=End time must be after start time. Overnight shifts are not supported yet.');
  if (b.id) {
    await db.query('UPDATE shifts SET name=$1, start_time=$2, end_time=$3, grace_minutes=$4, early_out_grace_minutes=$5, overtime_after_minutes=$6, weekly_off=$7 WHERE id=$8', [...vals, b.id]);
  } else {
    await db.query('INSERT INTO shifts (name, start_time, end_time, grace_minutes, early_out_grace_minutes, overtime_after_minutes, weekly_off) VALUES ($1,$2,$3,$4,$5,$6,$7)', vals);
  }
  await audit.log(req, b.id ? 'shift.update' : 'shift.create', 'shift', b.id || null, { name: vals[0] });
  res.redirect(`/shifts?ok=Saved ${vals[0]}. Use Recalculate on the Attendance page to apply it to past days.`);
});

router.post('/shifts/:id/delete', hrAdmin, async (req, res) => {
  const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM employees WHERE shift_id = $1', [req.params.id]);
  if (c.n) return res.redirect('/shifts?err=This shift still has employees assigned.');
  await db.query('DELETE FROM shifts WHERE id = $1', [req.params.id]);
  await audit.log(req, 'shift.delete', 'shift', req.params.id);
  res.redirect('/shifts?ok=Shift deleted.');
});

// ---- Holidays
router.get('/holidays', hrAdmin, async (req, res) => {
  const { rows } = await db.query('SELECT id, holiday_date::text AS date, name FROM holidays ORDER BY holiday_date DESC LIMIT 200');
  res.render('holidays', { title: 'Holidays', rows, ok: req.query.ok, err: req.query.err });
});
router.post('/holidays', hrAdmin, async (req, res) => {
  const name = clean(req.body.name); const date = clean(req.body.holiday_date);
  if (!name || !date) return res.redirect('/holidays?err=Date and name are required.');
  await db.query('INSERT INTO holidays (holiday_date, name) VALUES ($1,$2) ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name', [date, name]);
  await audit.log(req, 'holiday.save', 'holiday', date, { name });
  res.redirect('/holidays?ok=Holiday saved.');
});
router.post('/holidays/:id/delete', hrAdmin, async (req, res) => {
  await db.query('DELETE FROM holidays WHERE id = $1', [req.params.id]);
  await audit.log(req, 'holiday.delete', 'holiday', req.params.id);
  res.redirect('/holidays?ok=Holiday removed.');
});

// ---- Settings and audit log (Admin only)
router.get('/settings', adminOnly, async (req, res) => {
  res.render('settings', { title: 'Settings', s: await settings.all(), ok: req.query.ok, err: req.query.err });
});
router.post('/settings', adminOnly, async (req, res) => {
  const name = clean(req.body.company_name);
  if (!name) return res.redirect('/settings?err=Company name is required.');
  await settings.set('company_name', name);
  await settings.set('duplicate_gap_minutes', int(req.body.duplicate_gap_minutes, 2));
  await audit.log(req, 'settings.update', 'settings', null);
  res.redirect('/settings?ok=Settings saved.');
});
router.get('/audit', adminOnly, async (req, res) => {
  const { rows } = await db.query('SELECT created_at, username, action, entity, entity_id, details FROM audit_logs ORDER BY id DESC LIMIT 200');
  res.render('audit', { title: 'Audit log', rows });
});

module.exports = router;
