const express = require('express');
const db = require('../db/pool');
const audit = require('../lib/audit');
const { computeDay, computeAll } = require('../lib/attendanceEngine');
const { monthData } = require('../lib/dashboard');
const { nowLocal } = require('../lib/time');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const hrAdmin = [requireAuth, requireRole('admin', 'hr')];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const isMonth = (s) => /^\d{4}-\d{2}$/.test(String(s || ''));

router.get('/attendance', hrAdmin, async (req, res) => {
  const now = nowLocal();
  const date = isDate(req.query.date) ? req.query.date : now.date;
  const dept = req.query.dept || ''; const status = req.query.status || '';
  const params = [date]; let deptSql = '';
  if (dept) { params.push(dept); deptSql = `AND e.department = $${params.length}`; }
  const { rows } = await db.query(
    `SELECT e.id, e.emp_code, e.full_name, e.department, s.name AS shift_name, a.status, a.check_in::text AS ci, a.check_out::text AS co,
            a.late_minutes, a.early_out_minutes, a.overtime_minutes, a.work_minutes, a.missing_punch, a.punch_count, a.remarks
       FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = $1
      WHERE e.active ${deptSql} ORDER BY e.emp_code`, params
  );
  const filtered = status ? rows.filter((r) => (status === 'not_in' ? !r.status : r.status === status || (status === 'missing' && r.missing_punch))) : rows;
  const { rows: depts } = await db.query("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department");
  const { rows: people } = await db.query('SELECT id, emp_code, full_name FROM employees WHERE active ORDER BY full_name');
  res.render('attendance', { title: 'Attendance', date, today: now.date, rows: filtered, depts: depts.map((d) => d.department), dept, status, people, ok: req.query.ok, err: req.query.err });
});

router.post('/attendance/punch', hrAdmin, async (req, res) => {
  const { employee_id: empId, date, time, note } = req.body;
  const back = `/attendance?date=${isDate(date) ? date : ''}`;
  if (!isDate(date) || !/^\d{2}:\d{2}$/.test(String(time || '')) || !String(note || '').trim()) {
    return res.redirect(`${back}&err=Employee, date, time and a reason are required.`);
  }
  const { rows: [e] } = await db.query('SELECT id, emp_code, device_user_id FROM employees WHERE id = $1', [empId]);
  if (!e) return res.redirect(`${back}&err=Employee not found.`);
  const pin = e.device_user_id || `M-${e.emp_code}`;
  const ins = await db.query(
    `INSERT INTO punches (employee_id, device_user_id, punch_time, source, note, created_by)
     VALUES ($1,$2,$3,'manual',$4,$5) ON CONFLICT (device_user_id, punch_time) DO NOTHING`,
    [e.id, pin, `${date} ${time}:00`, String(note).trim(), req.user.id]
  );
  if (!ins.rowCount) return res.redirect(`${back}&err=A punch already exists at that time.`);
  await computeDay(e.id, date, { silent: true });
  await audit.log(req, 'punch.manual', 'employee', e.id, { date, time, note: String(note).trim() });
  return res.redirect(`${back}&ok=Punch added and attendance recalculated.`);
});

router.post('/attendance/recalculate', hrAdmin, async (req, res) => {
  const date = isDate(req.body.date) ? req.body.date : nowLocal().date;
  const n = await computeAll(date, { silent: true });
  await audit.log(req, 'attendance.recalculate', 'date', date, { records: n });
  res.redirect(`/attendance?date=${date}&ok=Recalculated ${n} records for ${date}.`);
});

router.get('/attendance/employee/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (req.user.role === 'staff' && req.user.employee_id !== id) {
    return res.status(403).render('error', { title: 'No access', code: 403, message: 'You can only view your own attendance.' });
  }
  const { rows: [emp] } = await db.query('SELECT id, emp_code, full_name, department, designation FROM employees WHERE id = $1', [id]);
  if (!emp) return res.status(404).render('error', { title: 'Not found', code: 404, message: 'Employee not found.' });
  const now = nowLocal();
  const month = isMonth(req.query.month) ? req.query.month : now.date.slice(0, 7);
  const data = await monthData(id, month);
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  res.render('employee-month', { title: emp.full_name, emp, month, prev, next, canNext: next <= now.date.slice(0, 7), data });
});

router.get('/my-attendance', requireAuth, (req, res) => {
  if (!req.user.employee_id) return res.status(404).render('error', { title: 'No profile', code: 404, message: 'Your login is not linked to an employee profile yet. Ask HR to link it.' });
  return res.redirect(`/attendance/employee/${req.user.employee_id}`);
});

module.exports = router;
