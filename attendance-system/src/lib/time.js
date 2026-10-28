const config = require('../config');

const dtf = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const pad = (n) => String(n).padStart(2, '0');

function nowLocal() {
  const p = Object.fromEntries(dtf.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), time: `${p.hour}:${p.minute}` };
}

const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + (Number(m) || 0); };
const toSec = (t) => { const [h, m, s] = String(t).split(':'); return Number(h) * 3600 + (Number(m) || 0) * 60 + (Number(s) || 0); };

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

function range(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${pad(last)}` };
}

const fmtDur = (m) => (m ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : '–');
const fmtClock = (ts) => (ts ? String(ts).slice(11, 16) : '–');

module.exports = { nowLocal, toMin, toSec, addDays, weekday, range, monthBounds, fmtDur, fmtClock, pad };
