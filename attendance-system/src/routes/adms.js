// ZKTeco "Push SDK" (ADMS) endpoints. Point the device's cloud/server setting at <your-host>/iclock.
const express = require('express');
const db = require('../db/pool');
const { computeDay } = require('../lib/attendanceEngine');

const router = express.Router();
router.use(express.text({ type: () => true, limit: '5mb' }));

const LINE = /^(\S+)\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s+(\d+))?(?:\s+(\d+))?/;

async function deviceFor(req, res) {
  const sn = String(req.query.SN || '').trim();
  const { rows: [dev] } = sn ? await db.query('SELECT * FROM devices WHERE serial_number = $1 AND active', [sn]) : { rows: [] };
  if (!dev) {
    res.status(403).type('text/plain').send('ERROR: unknown device');
    return null;
  }
  await db.query('UPDATE devices SET last_seen_at = NOW() WHERE id = $1', [dev.id]);
  return dev;
}

// Handshake: the device asks which options to use.
router.get('/cdata', async (req, res) => {
  const dev = await deviceFor(req, res);
  if (!dev) return;
  const lines = [
    `GET OPTION FROM: ${dev.serial_number}`,
    `ATTLOGStamp=${dev.last_stamp || 'None'}`,
    'OPERLOGStamp=9999', 'ATTPHOTOStamp=None', 'ErrorDelay=30', 'Delay=10',
    'TransTimes=00:00;14:00', 'TransInterval=1', 'TransFlag=TransData AttLog\tOpLog', 'Realtime=1', 'Encrypt=None',
  ];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
});

// Attendance logs pushed by the device: PIN <tab> YYYY-MM-DD HH:MM:SS <tab> status <tab> verify ...
router.post('/cdata', async (req, res) => {
  const dev = await deviceFor(req, res);
  if (!dev) return;
  if (String(req.query.table || '').toUpperCase() !== 'ATTLOG') return res.type('text/plain').send('OK');

  const body = typeof req.body === 'string' ? req.body : '';
  const records = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((l) => LINE.exec(l)).filter(Boolean)
    .map((m) => ({ pin: m[1], date: m[2], time: `${m[2]} ${m[3]}`, status: m[4] != null ? Number(m[4]) : null, verify: m[5] != null ? Number(m[5]) : null }));

  const pins = [...new Set(records.map((r) => r.pin))];
  const { rows: emps } = pins.length ? await db.query('SELECT id, device_user_id FROM employees WHERE device_user_id = ANY($1)', [pins]) : { rows: [] };
  const byPin = new Map(emps.map((e) => [e.device_user_id, e.id]));

  const touched = new Map();
  for (const r of records) {
    const empId = byPin.get(r.pin) || null;
    const ins = await db.query(
      `INSERT INTO punches (employee_id, device_id, device_user_id, punch_time, status_code, verify_mode, source)
       VALUES ($1,$2,$3,$4,$5,$6,'device') ON CONFLICT (device_user_id, punch_time) DO NOTHING`,
      [empId, dev.id, r.pin, r.time, r.status, r.verify]
    );
    if (ins.rowCount && empId) touched.set(`${empId}|${r.date}`, [empId, r.date]);
  }
  for (const [empId, date] of touched.values()) {
    try { await computeDay(empId, date); } catch (e) { console.error('computeDay failed:', e.message); }
  }
  await db.query('UPDATE devices SET last_sync_at = NOW(), last_stamp = COALESCE($2, last_stamp) WHERE id = $1', [dev.id, req.query.Stamp || null]);
  res.type('text/plain').send(`OK: ${records.length}`);
});

router.get('/getrequest', async (req, res) => { if (await deviceFor(req, res)) res.type('text/plain').send('OK'); });
router.post('/devicecmd', async (req, res) => { if (await deviceFor(req, res)) res.type('text/plain').send('OK'); });

module.exports = router;
