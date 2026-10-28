const db = require('../db/pool');
const { nowLocal, weekday, addDays, range, monthBounds } = require('./time');

const slim = (p) => ({ id: p.id, name: p.full_name, code: p.emp_code, dept: p.department || '', in: p.ci ? p.ci.slice(11, 16) : null, late: p.late_minutes || 0 });

async function todaySnapshot() {
  const now = nowLocal();
  const { rows: hol } = await db.query('SELECT name FROM holidays WHERE holiday_date = $1', [now.date]);
  const { rows } = await db.query(
    `SELECT e.id, e.emp_code, e.full_name, e.department, s.weekly_off,
            a.status, a.check_in::text AS ci, a.late_minutes, a.missing_punch
       FROM employees e
       LEFT JOIN shifts s ON s.id = e.shift_id
       LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = $1
      WHERE e.active ORDER BY e.full_name`,
    [now.date]
  );
  const dow = weekday(now.date);
  const people = rows.map((r) => ({ ...r, off: hol.length > 0 || (r.weekly_off || []).includes(dow) }));
  const expected = people.filter((p) => !p.off);
  const present = expected.filter((p) => p.ci);
  const late = expected.filter((p) => p.status === 'late');
  const notIn = expected.filter((p) => !p.ci);

  const depts = {};
  expected.forEach((p) => {
    const d = p.department || 'Unassigned';
    depts[d] = depts[d] || { name: d, total: 0, present: 0, late: 0 };
    depts[d].total += 1;
    if (p.ci) depts[d].present += 1;
    if (p.status === 'late') depts[d].late += 1;
  });

  const { rows: recent } = await db.query(
    `SELECT p.punch_time::text AS t, e.full_name, e.emp_code, d.name AS device
       FROM punches p LEFT JOIN employees e ON e.id = p.employee_id LEFT JOIN devices d ON d.id = p.device_id
      ORDER BY p.punch_time DESC, p.id DESC LIMIT 10`
  );

  return {
    date: now.date, time: now.time, holiday: hol[0]?.name || null,
    totals: { employees: people.length, expected: expected.length, present: present.length, late: late.length, onTime: present.length - late.length, notIn: notIn.length, off: people.length - expected.length },
    late: late.map(slim), notIn: notIn.map(slim),
    departments: Object.values(depts).sort((a, b) => a.name.localeCompare(b.name)),
    recent: recent.map((r) => ({ time: r.t.slice(11, 16), date: r.t.slice(0, 10), name: r.full_name || 'Unmatched punch', code: r.emp_code || '', device: r.device || 'Manual' })),
  };
}

async function trend(days = 7) {
  const now = nowLocal();
  const from = addDays(now.date, -(days - 1));
  const { rows } = await db.query(
    `SELECT work_date::text AS d,
            COUNT(*) FILTER (WHERE status = 'present') AS present,
            COUNT(*) FILTER (WHERE status = 'late') AS late,
            COUNT(*) FILTER (WHERE status = 'absent') AS absent
       FROM attendance WHERE work_date BETWEEN $1 AND $2 GROUP BY work_date`,
    [from, now.date]
  );
  const map = Object.fromEntries(rows.map((r) => [r.d, r]));
  return range(from, now.date).map((d) => ({ date: d, present: Number(map[d]?.present || 0), late: Number(map[d]?.late || 0), absent: Number(map[d]?.absent || 0) }));
}

async function monthData(employeeId, month) {
  const { from, to } = monthBounds(month);
  const { rows } = await db.query(
    `SELECT work_date::text AS date, check_in::text AS ci, check_out::text AS co, status, late_minutes,
            early_out_minutes, overtime_minutes, work_minutes, missing_punch, remarks
       FROM attendance WHERE employee_id = $1 AND work_date BETWEEN $2 AND $3 ORDER BY work_date DESC`,
    [employeeId, from, to]
  );
  const sum = { present: 0, late: 0, absent: 0, lateMinutes: 0, overtimeMinutes: 0, workMinutes: 0, missing: 0 };
  rows.forEach((r) => {
    if (r.status === 'present' || r.status === 'late') sum.present += 1;
    if (r.status === 'late') sum.late += 1;
    if (r.status === 'absent') sum.absent += 1;
    sum.lateMinutes += r.late_minutes; sum.overtimeMinutes += r.overtime_minutes; sum.workMinutes += r.work_minutes;
    if (r.missing_punch) sum.missing += 1;
  });
  return { rows, sum, from, to };
}

module.exports = { todaySnapshot, trend, monthData };
