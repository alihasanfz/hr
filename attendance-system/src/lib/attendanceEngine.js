const db = require('../db/pool');
const settings = require('./settings');
const notify = require('./notify');
const { nowLocal, toMin, toSec, weekday, addDays } = require('./time');

/**
 * Recalculates one employee's attendance for one date from the raw punches.
 * - First punch = check-in, last punch = check-out (double taps inside the gap are merged).
 * - Late / early-out / overtime are measured against the employee's shift.
 * - Absent, missing punch and early-out alerts only fire once the day is closed
 *   (the date has passed, or one hour after the shift ends).
 * Returns the saved row, or null when there is nothing to record yet.
 */
async function computeDay(employeeId, date, opts = {}) {
  const now = nowLocal();
  if (date > now.date) return null;

  const { rows: [emp] } = await db.query(
    `SELECT e.id, e.emp_code, e.full_name, e.shift_id, e.join_date::text AS join_date,
            s.start_time::text AS start_time, s.end_time::text AS end_time,
            s.grace_minutes, s.early_out_grace_minutes, s.overtime_after_minutes, s.weekly_off
       FROM employees e LEFT JOIN shifts s ON s.id = e.shift_id WHERE e.id = $1`,
    [employeeId]
  );
  if (!emp) return null;
  if (emp.join_date && date < emp.join_date) return null;

  const gapMin = Number((await settings.all()).duplicate_gap_minutes) || 0;
  const { rows: raw } = await db.query(
    `SELECT punch_time::text AS t FROM punches
      WHERE employee_id = $1 AND punch_time >= $2::date AND punch_time < ($2::date + 1)
      ORDER BY punch_time`,
    [employeeId, date]
  );
  const punches = [];
  for (const p of raw) {
    const sec = toSec(p.t.slice(11, 19));
    if (!punches.length || sec - punches[punches.length - 1].sec >= gapMin * 60) punches.push({ sec, t: p.t });
  }

  const { rows: hol } = await db.query('SELECT name FROM holidays WHERE holiday_date = $1', [date]);
  const dayType = hol.length ? 'holiday' : (emp.weekly_off || []).includes(weekday(date)) ? 'weekend' : 'working';
  const startMin = emp.start_time ? toMin(emp.start_time) : null;
  const endMin = emp.end_time ? toMin(emp.end_time) : null;
  const dayClosed = date < now.date || (endMin != null && date === now.date && now.minutes >= endMin + 60);

  let status; let late = 0; let early = 0; let ot = 0; let work = 0; let missing = false; let remarks = null;
  const n = punches.length;
  const checkIn = n ? punches[0].t : null;
  const checkOut = n > 1 ? punches[n - 1].t : null;

  if (!n) {
    if (!emp.shift_id) return null;
    if (dayType !== 'working') status = dayType;
    else if (dayClosed) status = 'absent';
    else return null;
  } else {
    const inMin = Math.floor(punches[0].sec / 60);
    const outMin = checkOut ? Math.floor(punches[n - 1].sec / 60) : null;
    if (outMin != null) work = outMin - inMin;
    if (dayType === 'working' && startMin != null) {
      if (inMin > startMin + emp.grace_minutes) late = inMin - startMin;
      if (outMin != null && outMin < endMin - emp.early_out_grace_minutes) early = endMin - outMin;
      if (outMin != null && outMin >= endMin + emp.overtime_after_minutes) ot = outMin - endMin;
      status = late ? 'late' : 'present';
    } else {
      status = 'present';
      ot = work;
      remarks = dayType === 'holiday' ? 'Worked on a holiday' : dayType === 'weekend' ? 'Worked on a weekly off' : null;
    }
    missing = !checkOut && dayClosed;
  }

  const { rows: [row] } = await db.query(
    `INSERT INTO attendance (employee_id, work_date, shift_id, check_in, check_out, status, late_minutes,
        early_out_minutes, overtime_minutes, work_minutes, punch_count, missing_punch, remarks, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (employee_id, work_date) DO UPDATE SET
        shift_id = EXCLUDED.shift_id, check_in = EXCLUDED.check_in, check_out = EXCLUDED.check_out,
        status = EXCLUDED.status, late_minutes = EXCLUDED.late_minutes, early_out_minutes = EXCLUDED.early_out_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes, work_minutes = EXCLUDED.work_minutes,
        punch_count = EXCLUDED.punch_count, missing_punch = EXCLUDED.missing_punch,
        remarks = EXCLUDED.remarks, updated_at = NOW()
     RETURNING *`,
    [employeeId, date, emp.shift_id, checkIn, checkOut, status, late, early, ot, work, n, missing, remarks]
  );

  if (!opts.silent && date >= addDays(now.date, -1)) {
    const who = `${emp.full_name} (${emp.emp_code})`;
    if (status === 'late' && date === now.date) {
      await notify.exception('late', emp.id, date, 'Late arrival', `${who} checked in ${late} min late.`);
    }
    if (dayClosed) {
      if (status === 'absent') await notify.exception('absent', emp.id, date, 'Absent', `${who} has no punches for ${date}.`);
      if (missing) await notify.exception('missing_punch', emp.id, date, 'Missing check-out', `${who} has only one punch on ${date}.`);
      if (early > 0) await notify.exception('early_out', emp.id, date, 'Early departure', `${who} left ${early} min before shift end on ${date}.`);
    }
  }
  return row;
}

async function computeAll(date, opts = {}) {
  const { rows } = await db.query(
    'SELECT id FROM employees WHERE active AND (join_date IS NULL OR join_date <= $1::date)', [date]
  );
  let saved = 0;
  for (const r of rows) if (await computeDay(r.id, date, opts)) saved += 1;
  return saved;
}

module.exports = { computeDay, computeAll };
