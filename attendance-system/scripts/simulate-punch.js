#!/usr/bin/env node
// Fake ZKTeco device: sends attendance punches to the ADMS endpoint exactly like a real MB20 VL.
//   node scripts/simulate-punch.js --url http://localhost:3000 --sn ZKDEMO0001 --pin 1003
//   node scripts/simulate-punch.js --count 5                 five random employees, right now
//   node scripts/simulate-punch.js --pin 1003 --time "2026-10-27 09:25:00"
//   node scripts/simulate-punch.js --loop 5                  one random punch every 5 seconds
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith('--')) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return a;
}, []));

if (args.help) {
  console.log('Options: --url <server> --sn <serial> --pin <id> --pins 1001,1002 --time "YYYY-MM-DD HH:MM:SS" --count <n> --loop <seconds>');
  process.exit(0);
}

const url = (args.url || 'http://localhost:3000').replace(/\/$/, '');
const sn = args.sn || 'ZKDEMO0001';
const pins = (args.pins || '1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012').split(',');
const tz = process.env.TIMEZONE || 'Asia/Dhaka';

function localNow() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
const pick = () => pins[Math.floor(Math.random() * pins.length)];

async function send(list) {
  const body = list.map((r) => `${r.pin}\t${r.time}\t0\t1\t0\t0\t0\t0\t0\t0`).join('\n') + '\n';
  const hello = await fetch(`${url}/iclock/cdata?SN=${sn}&options=all&pushver=2.4.1`);
  if (!hello.ok) throw new Error(`Handshake failed (${hello.status}): ${await hello.text()}`);
  const res = await fetch(`${url}/iclock/cdata?SN=${sn}&table=ATTLOG&Stamp=${Date.now()}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body });
  console.log(`${res.status} ${(await res.text()).trim()}  <-  ${list.map((r) => `${r.pin} @ ${r.time}`).join(', ')}`);
}

(async () => {
  try {
    if (args.loop) {
      const every = Math.max(1, Number(args.loop)) * 1000;
      console.log(`Sending a random punch every ${every / 1000}s to ${url}. Press Ctrl+C to stop.`);
      await send([{ pin: pick(), time: localNow() }]);
      setInterval(() => send([{ pin: pick(), time: localNow() }]).catch((e) => console.error(e.message)), every);
      return;
    }
    const count = Math.max(1, Number(args.count) || 1);
    const list = [];
    for (let i = 0; i < count; i += 1) list.push({ pin: args.pin || pick(), time: args.time || localNow() });
    await send(list);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
})();
