const express = require('express');
const net = require('net');
const db = require('../db/pool');
const audit = require('../lib/audit');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));
const clean = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());

function tcpTest(host, port, timeout = 3000) {
  return new Promise((resolve) => {
    const t = Date.now();
    const s = net.connect({ host, port, timeout });
    s.once('connect', () => { s.destroy(); resolve({ ok: true, message: `Reachable in ${Date.now() - t} ms` }); });
    s.once('timeout', () => { s.destroy(); resolve({ ok: false, message: 'Timed out. Check the IP address, port and network.' }); });
    s.once('error', (e) => resolve({ ok: false, message: `Connection failed (${e.code || e.message})` }));
  });
}

router.get('/', async (req, res) => {
  const { rows } = await db.query(
    `SELECT *, (last_seen_at IS NOT NULL AND last_seen_at > NOW() - INTERVAL '10 minutes') AS online FROM devices ORDER BY name`
  );
  const edit = req.query.edit ? rows.find((r) => String(r.id) === String(req.query.edit)) : null;
  res.render('devices', { title: 'Devices', rows, edit, admsUrl: `${req.protocol}://${req.get('host')}/iclock`, ok: req.query.ok, err: req.query.err });
});

router.post('/', async (req, res) => {
  const b = req.body;
  const v = [clean(b.name), clean(b.serial_number), clean(b.model) || 'ZKTeco MB20 VL', clean(b.ip_address), Number(b.port) || 4370, clean(b.api_url), clean(b.location), b.active === 'on'];
  if (!v[0] || !v[1]) return res.redirect('/devices?err=Device name and serial number are required.');
  if (v[5] && !/^https?:\/\//i.test(v[5])) return res.redirect('/devices?err=API URL must start with http:// or https://');
  try {
    if (b.id) {
      await db.query('UPDATE devices SET name=$1, serial_number=$2, model=$3, ip_address=$4, port=$5, api_url=$6, location=$7, active=$8 WHERE id=$9', [...v, b.id]);
    } else {
      await db.query('INSERT INTO devices (name, serial_number, model, ip_address, port, api_url, location, active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', v);
    }
  } catch (e) {
    if (e.code === '23505') return res.redirect('/devices?err=That serial number is already registered.');
    throw e;
  }
  await audit.log(req, b.id ? 'device.update' : 'device.create', 'device', b.id || null, { name: v[0], ip: v[3], api_url: v[5] });
  res.redirect('/devices?ok=Device settings saved.');
});

router.post('/:id/delete', async (req, res) => {
  await db.query('DELETE FROM devices WHERE id = $1', [req.params.id]);
  await audit.log(req, 'device.delete', 'device', req.params.id);
  res.redirect('/devices?ok=Device removed. Its punches are kept.');
});

router.post('/:id/test', async (req, res) => {
  const { rows: [d] } = await db.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
  if (!d) return res.status(404).json({ ok: false, message: 'Device not found' });
  if (d.ip_address) return res.json(await tcpTest(d.ip_address, d.port));
  if (d.api_url) {
    try {
      const r = await fetch(d.api_url, { signal: AbortSignal.timeout(4000) });
      return res.json({ ok: true, message: `API answered with HTTP ${r.status}` });
    } catch (e) { return res.json({ ok: false, message: 'API URL did not answer.' }); }
  }
  return res.json({ ok: false, message: 'Add an IP address or API URL first.' });
});

module.exports = router;
