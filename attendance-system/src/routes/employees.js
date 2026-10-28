const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const audit = require('../lib/audit');
const { computeDay } = require('../lib/attendanceEngine');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'hr'));

const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const shiftsList = async () => (await db.query('SELECT id, name, start_time::text AS st, end_time::text AS et FROM shifts WHERE active ORDER BY name')).rows;

router.get('/', async (req, res) => {
  const q = clean(req.query.q); const dept = clean(req.query.dept); const status = req.query.status || 'active';
  const where = []; const params = [];
  if (q) { params.push(`%${q}%`); where.push(`(e.full_name ILIKE $${params.length} OR e.emp_code ILIKE $${params.length} OR e.device_user_id ILIKE $${params.length})`); }
  if (dept) { params.push(dept); where.push(`e.department = $${params.length}`); }
  if (status === 'active') where.push('e.active'); else if (status === 'inactive') where.push('NOT e.active');
  const { rows } = await db.query(
    `SELECT e.*, s.name AS shift_name, u.username FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id LEFT JOIN users u ON u.id = e.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY e.emp_code`, params
  );
  const { rows: depts } = await db.query("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department");
  const { rows: [un] } = await db.query('SELECT COUNT(DISTINCT device_user_id)::int AS n FROM punches WHERE employee_id IS NULL');
  res.render('employees', { title: 'Employees', rows, depts: depts.map((d) => d.department), q: q || '', dept: dept || '', status, unmatched: un.n, ok: req.query.ok, err: req.query.err });
});

router.get('/new', async (req, res) => {
  res.render('employee-form', { title: 'Add employee', emp: null, shifts: await shiftsList(), err: req.query.err });
});

router.get('/:id/edit', async (req, res) => {
  const { rows: [emp] } = await db.query(
    `SELECT e.*, e.join_date::text AS join_date_s, u.username, u.role FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1`, [req.params.id]
  );
  if (!emp) return res.status(404).render('error', { title: 'Not found', code: 404, message: 'Employee not found.' });
  res.render('employee-form', { title: 'Edit employee', emp, shifts: await shiftsList(), err: req.query.err });
});

async function save(req, res, id) {
  const b = req.body;
  const d = {
    emp_code: clean(b.emp_code), full_name: clean(b.full_name), department: clean(b.department), designation: clean(b.designation),
    phone: clean(b.phone), device_user_id: clean(b.device_user_id), shift_id: clean(b.shift_id), join_date: clean(b.join_date), active: b.active === 'on',
  };
  const back = id ? `/employees/${id}/edit` : '/employees/new';
  if (!d.emp_code || !d.full_name) return res.redirect(`${back}?err=Employee code and full name are required.`);
  const username = (clean(b.username) || '').toLowerCase() || null;
  const password = clean(b.password);
  if (password && password.length < 8) return res.redirect(`${back}?err=Password must be at least 8 characters.`);

  try {
    let empId = id; let existing = null;
    if (id) {
      ({ rows: [existing] } = await db.query('SELECT e.user_id, u.role FROM employees e LEFT JOIN users u ON u.id = e.user_id WHERE e.id = $1', [id]));
      await db.query(
        `UPDATE employees SET emp_code=$1, full_name=$2, department=$3, designation=$4, phone=$5, device_user_id=$6,
                shift_id=$7, join_date=$8, active=$9 WHERE id=$10`,
        [d.emp_code, d.full_name, d.department, d.designation, d.phone, d.device_user_id, d.shift_id, d.join_date, d.active, id]
      );
    } else {
      const { rows: [row] } = await db.query(
        `INSERT INTO employees (emp_code, full_name, department, designation, phone, device_user_id, shift_id, join_date, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [d.emp_code, d.full_name, d.department, d.designation, d.phone, d.device_user_id, d.shift_id, d.join_date, d.active]
      );
      empId = row.id;
    }

    const protectedAdmin = existing && existing.role === 'admin' && req.user.role !== 'admin';
    const role = req.user.role === 'admin' && ['admin', 'hr', 'staff'].includes(b.role) ? b.role : 'staff';
    if (!protectedAdmin) {
      if (existing && existing.user_id) {
        if (username) await db.query('UPDATE users SET username = $1 WHERE id = $2', [username, existing.user_id]);
        if (password) await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(password, 10), existing.user_id]);
        if (req.user.role === 'admin' && existing.user_id !== req.user.id) await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, existing.user_id]);
        if (existing.user_id !== req.user.id) await db.query('UPDATE users SET active = $1 WHERE id = $2', [d.active, existing.user_id]);
      } else if (username && password) {
        const { rows: [u] } = await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id', [username, await bcrypt.hash(password, 10), role]);
        await db.query('UPDATE employees SET user_id = $1 WHERE id = $2', [u.id, empId]);
      }
    }

    if (d.device_user_id) {
      const { rows } = await db.query(
        'UPDATE punches SET employee_id = $1 WHERE employee_id IS NULL AND device_user_id = $2 RETURNING punch_time::date::text AS d', [empId, d.device_user_id]
      );
      for (const date of [...new Set(rows.map((r) => r.d))].slice(-31)) await computeDay(empId, date, { silent: true });
    }
    await audit.log(req, id ? 'employee.update' : 'employee.create', 'employee', empId, { emp_code: d.emp_code });
    return res.redirect(`/employees?ok=Saved ${d.full_name}.`);
  } catch (e) {
    if (e.code === '23505') return res.redirect(`${back}?err=Employee code, device PIN or username is already in use.`);
    throw e;
  }
}

router.post('/', (req, res) => save(req, res, null));
router.post('/:id', (req, res) => save(req, res, Number(req.params.id)));

module.exports = router;
