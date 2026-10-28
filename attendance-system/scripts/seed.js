// Demo data: shifts, users, 12 employees, one ZKTeco device, holidays and 30 days of punches.
// Runs automatically on first start when SEED_DEMO=true and the database has no users.
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const db = require('../src/db/pool');
const migrate = require('../src/db/migrate');
const { computeDay } = require('../src/lib/attendanceEngine');
const { nowLocal, addDays, range, weekday, pad } = require('../src/lib/time');

function rng(seed) {
  let a = seed;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const fmt = (min, sec = 0) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}:${pad(sec)}`;

const PEOPLE = [
  ['E001', 'Rahim Uddin', 'Operations', 'Operations Manager', '1001', 0],
  ['E002', 'Nusrat Jahan', 'HR', 'HR Executive', '1002', 0],
  ['E003', 'Tanvir Hossain', 'IT', 'Software Developer', '1003', 0],
  ['E004', 'Farhana Akter', 'Accounts', 'Accountant', '1004', 0],
  ['E005', 'Mizanur Rahman', 'Sales', 'Sales Executive', '1005', 0],
  ['E006', 'Sadia Islam', 'Sales', 'Sales Executive', '1006', 0],
  ['E007', 'Kamal Hossain', 'Operations', 'Supervisor', '1007', 1],
  ['E008', 'Shirin Sultana', 'Accounts', 'Accounts Officer', '1008', 0],
  ['E009', 'Arif Chowdhury', 'IT', 'Support Engineer', '1009', 0],
  ['E010', 'Mou Khatun', 'HR', 'HR Assistant', '1010', 0],
  ['E011', 'Jahid Hasan', 'Operations', 'Machine Operator', '1011', 1],
  ['E012', 'Rokeya Begum', 'Admin', 'Office Assistant', '1012', 0],
];
const SHIFTS = [['General (09:00-18:00)', 540, 1080], ['Early (07:00-15:00)', 420, 900]];

async function seed() {
  await migrate();
  const rand = rng(42);
  const hash = await bcrypt.hash(config.demoPassword, 10);

  const shiftIds = [];
  for (const [name, s, e] of SHIFTS) {
    const { rows: [r] } = await db.query(
      `INSERT INTO shifts (name, start_time, end_time, grace_minutes, early_out_grace_minutes, overtime_after_minutes, weekly_off)
       VALUES ($1,$2,$3,10,0,30,'{5}') RETURNING id`, [name, fmt(s), fmt(e)]
    );
    shiftIds.push(r.id);
  }

  const user = async (username, role) => (await db.query('INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING id', [username, hash, role])).rows[0].id;
  const adminId = await user('admin', 'admin');
  const hrId = await user('hr', 'hr');
  const staffId = await user('staff', 'staff');

  const emps = [];
  for (const [code, name, dept, desig, pin, sh] of PEOPLE) {
    const userId = code === 'E002' ? hrId : code === 'E005' ? staffId : null;
    const { rows: [e] } = await db.query(
      `INSERT INTO employees (user_id, emp_code, full_name, department, designation, device_user_id, shift_id, join_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'2025-01-01') RETURNING id`, [userId, code, name, dept, desig, pin, shiftIds[sh]]
    );
    emps.push({ id: e.id, pin, start: SHIFTS[sh][1], end: SHIFTS[sh][2] });
  }

  const { rows: [dev] } = await db.query(
    `INSERT INTO devices (name, serial_number, ip_address, port, location) VALUES ('Main gate MB20 VL','ZKDEMO0001','192.168.1.201',4370,'Head office') RETURNING id`
  );
  for (const [d, n] of [['2026-12-16', 'Victory Day'], ['2026-12-25', 'Christmas Day'], ['2027-02-21', 'International Mother Language Day'], ['2027-03-26', 'Independence Day']]) {
    await db.query('INSERT INTO holidays (holiday_date, name) VALUES ($1,$2)', [d, n]);
  }

  const punch = (e, date, min) => db.query(
    `INSERT INTO punches (employee_id, device_id, device_user_id, punch_time, status_code, verify_mode, source)
     VALUES ($1,$2,$3,$4,0,1,'device') ON CONFLICT DO NOTHING`, [e.id, dev.id, e.pin, `${date} ${fmt(min, Math.floor(rand() * 60))}`]
  );
  const arrival = (e) => {
    const r = rand();
    if (r < 0.7) return e.start - 25 + Math.floor(rand() * 33);
    return e.start + 12 + Math.floor(rand() * 35);
  };

  const now = nowLocal();
  for (const date of range(addDays(now.date, -30), addDays(now.date, -1))) {
    if (weekday(date) === 5) continue;
    for (const e of emps) {
      if (rand() < 0.05) continue;
      await punch(e, date, arrival(e));
      const r = rand();
      if (r < 0.03) { /* forgot to punch out */ } else if (r < 0.11) await punch(e, date, e.end - 15 - Math.floor(rand() * 75));
      else await punch(e, date, e.end - 5 + Math.floor(rand() * 85));
      await computeDay(e.id, date, { silent: true });
    }
  }

  if (weekday(now.date) !== 5) {
    for (const e of emps) {
      if (rand() < 0.15) continue;
      const t = arrival(e);
      if (t < now.minutes) { await punch(e, now.date, t); await computeDay(e.id, now.date); }
    }
  }
  console.log(`Demo data created. Sign in as admin, hr or staff with password "${config.demoPassword}".`);
}

module.exports = seed;

if (require.main === module) {
  (async () => {
    const { rows: [c] } = await db.query('SELECT COUNT(*)::int AS n FROM users').catch(() => ({ rows: [{ n: 0 }] }));
    if (c.n > 0 && !process.argv.includes('--force')) { console.log('Users already exist. Nothing seeded (use --force to add anyway).'); process.exit(0); }
    await seed();
    process.exit(0);
  })().catch((e) => { console.error(e); process.exit(1); });
}
