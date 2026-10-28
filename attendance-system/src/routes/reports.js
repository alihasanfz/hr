const express = require('express');
const db = require('../db/pool');
const { sendXlsx, sendPdf } = require('../lib/exporters');
const { nowLocal, fmtClock, fmtDur } = require('../lib/time');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin', 'hr'));

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const LABEL = { present: 'On time', late: 'Late', absent: 'Absent', weekend: 'Weekly off', holiday: 'Holiday' };

const DETAIL_COLS = [
  { key: 'date', label: 'Date', w: 9, xw: 12 }, { key: 'code', label: 'Code', w: 7, xw: 10 }, { key: 'name', label: 'Employee', w: 17, xw: 26 },
  { key: 'dept', label: 'Department', w: 12, xw: 18 }, { key: 'status', label: 'Status', w: 8, xw: 12 }, { key: 'in', label: 'In', w: 6, xw: 8 },
  { key: 'out', label: 'Out', w: 6, xw: 8 }, { key: 'late', label: 'Late (min)', w: 7, xw: 11 }, { key: 'early', label: 'Early out (min)', w: 8, xw: 15 },
  { key: 'ot', label: 'Overtime', w: 8, xw: 11 }, { key: 'worked', label: 'Worked', w: 8, xw: 11 }, { key: 'flag', label: 'Note', w: 10, xw: 18 },
];
const SUMMARY_COLS = [
  { key: 'code', label: 'Code', w: 7, xw: 10 }, { key: 'name', label: 'Employee', w: 18, xw: 26 }, { key: 'dept', label: 'Department', w: 12, xw: 18 },
  { key: 'present', label: 'Days present', w: 8, xw: 13 }, { key: 'lateDays', label: 'Late days', w: 7, xw: 11 }, { key: 'late', label: 'Late (min)', w: 8, xw: 11 },
  { key: 'absent', label: 'Absent days', w: 8, xw: 13 }, { key: 'early', label: 'Early out (min)', w: 9, xw: 15 }, { key: 'ot', label: 'Overtime', w: 9, xw: 11 },
  { key: 'worked', label: 'Worked', w: 9, xw: 11 }, { key: 'missing', label: 'Missing punches', w: 9, xw: 15 },
];

function filters(q) {
  const now = nowLocal();
  return {
    type: q.type === 'summary' ? 'summary' : 'detail',
    from: isDate(q.from) ? q.from : `${now.date.slice(0, 8)}01`,
    to: isDate(q.to) ? q.to : now.date,
    dept: q.dept || '', employee: q.employee || '',
  };
}

async function build(f) {
  const params = [f.from, f.to]; let extra = '';
  if (f.dept) { params.push(f.dept); extra += ` AND e.department = $${params.length}`; }
  if (f.employee) { params.push(Number(f.employee)); extra += ` AND e.id = $${params.length}`; }

  if (f.type === 'summary') {
    const { rows } = await db.query(
      `SELECT e.emp_code, e.full_name, e.department,
              COUNT(*) FILTER (WHERE a.status IN ('present','late')) AS present,
              COUNT(*) FILTER (WHERE a.status = 'late') AS late_days,
              COALESCE(SUM(a.late_minutes), 0) AS late, COUNT(*) FILTER (WHERE a.status = 'absent') AS absent,
              COALESCE(SUM(a.early_out_minutes), 0) AS early, COALESCE(SUM(a.overtime_minutes), 0) AS ot,
              COALESCE(SUM(a.work_minutes), 0) AS worked, COUNT(*) FILTER (WHERE a.missing_punch) AS missing
         FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date BETWEEN $1 AND $2
        WHERE e.active ${extra} GROUP BY e.id ORDER BY e.emp_code`, params
    );
    return { columns: SUMMARY_COLS, rows: rows.map((r) => ({ code: r.emp_code, name: r.full_name, dept: r.department || '', present: Number(r.present), lateDays: Number(r.late_days), late: Number(r.late), absent: Number(r.absent), early: Number(r.early), ot: fmtDur(Number(r.ot)), worked: fmtDur(Number(r.worked)), missing: Number(r.missing) })) };
  }
  const { rows } = await db.query(
    `SELECT a.work_date::text AS date, e.emp_code, e.full_name, e.department, a.status, a.check_in::text AS ci, a.check_out::text AS co,
            a.late_minutes, a.early_out_minutes, a.overtime_minutes, a.work_minutes, a.missing_punch, a.remarks
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.work_date BETWEEN $1 AND $2 ${extra} ORDER BY a.work_date, e.emp_code`, params
  );
  return { columns: DETAIL_COLS, rows: rows.map((r) => ({ date: r.date, code: r.emp_code, name: r.full_name, dept: r.department || '', status: LABEL[r.status], in: fmtClock(r.ci), out: fmtClock(r.co), late: r.late_minutes, early: r.early_out_minutes, ot: fmtDur(r.overtime_minutes), worked: fmtDur(r.work_minutes), flag: r.missing_punch ? 'Missing check-out' : r.remarks || '' })) };
}

router.get('/', async (req, res) => {
  const f = filters(req.query);
  const { rows: depts } = await db.query("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department");
  const { rows: people } = await db.query('SELECT id, emp_code, full_name FROM employees WHERE active ORDER BY full_name');
  const ran = req.query.run === '1';
  const result = ran ? await build(f) : null;
  const qs = new URLSearchParams({ type: f.type, from: f.from, to: f.to, dept: f.dept, employee: f.employee }).toString();
  res.render('reports', { title: 'Reports', f, depts: depts.map((d) => d.department), people, result, total: result ? result.rows.length : 0, qs });
});

router.get('/export', async (req, res) => {
  const f = filters(req.query);
  const { columns, rows } = await build(f);
  const filename = `attendance-${f.type}-${f.from}-to-${f.to}`;
  const title = f.type === 'summary' ? 'Attendance summary' : 'Attendance detail';
  const subtitle = `${f.from} to ${f.to}${f.dept ? ` · ${f.dept}` : ''} · ${rows.length} rows · generated ${nowLocal().date} ${nowLocal().time}`;
  if (req.query.format === 'pdf') return sendPdf(res, { filename, title, subtitle, columns, rows });
  return sendXlsx(res, { filename, sheet: title, columns, rows });
});

module.exports = router;
