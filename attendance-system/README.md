# Attendance System

Attendance management PWA for office staff, built for the ZKTeco MB20 VL (ADMS push).
Node.js, Express, EJS and PostgreSQL. Leave and payroll are intentionally left for a later phase.

## What it does

- **Device integration**: ZKTeco ADMS endpoint at `/iclock`, device settings (IP, port, API URL, serial number) stored in the database and editable in the dashboard, connection test.
- **Roles**: Admin (everything), HR (employees, shifts, holidays, attendance, reports), Staff (own day and own history).
- **Attendance engine**: first punch is check-in, last punch is check-out, double taps merged. Late in, early out, overtime, missing check-out, absent, weekly off and holidays are calculated per shift.
- **Dashboard**: live today view (refreshes every 20 seconds), 7-day chart, department breakdown, needs-attention list.
- **Reports**: daily detail and per-employee summary, filtered by dates, department and employee. Download as Excel or PDF.
- **Alerts**: late arrival, absence, missing check-out and early departure go to an in-app inbox and, when VAPID keys are set, to Admin and HR phones as push notifications.
- **User management**: Admin adds, edits, disables and deletes sign-in users (Users page). Admin can edit or permanently delete employees. HR can edit employees.
- **Audit log** of employee, device, shift, holiday, settings and manual punch changes.

## Run locally with Docker

```bash
docker compose up --build
```

The database starts empty. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` (10+ characters) in the environment before the first start and the first Admin is created automatically. After that, add shifts, holidays, employees and devices from the dashboard.

## Run without Docker

```bash
cp .env.example .env        # set DATABASE_URL and JWT_SECRET
npm install
npm run dev
```

## Deploy: Render + Neon

1. **Neon**: create a project, copy the connection string (it contains `sslmode=require`).
2. **GitHub**: push this folder to a repository.
3. **Render**: New > Blueprint (uses `render.yaml`), or New > Web Service with build command `npm install --omit=dev` and start command `npm start`. Health check path `/healthz`.
4. Environment variables: `DATABASE_URL` (Neon), `JWT_SECRET` (generated), `TIMEZONE=Asia/Dhaka`, `COMPANY_NAME`, `ADMIN_USERNAME` and `ADMIN_PASSWORD` (first Admin, created only while the database has no users).
5. Open the Render URL and sign in with the Admin you set, then delete `ADMIN_PASSWORD` from the environment.

Notes for production:

- The Render free plan sleeps after inactivity. A sleeping service misses device pushes until it wakes, and the 15-minute close job does not run. Use a paid always-on instance for real attendance.
- The device pushes to `http://<host>/iclock`. Render redirects HTTP to HTTPS, and some ZKTeco firmware does not follow redirects. Test with the real device before relying on it. If the device cannot connect, put it behind a small VPS or reverse proxy that accepts plain HTTP.
- Phone alerts need HTTPS and VAPID keys: run `npm run vapid`, add both keys and set `VAPID_SUBJECT` (for example `mailto:you@yourcompany.com`).

## Connect the real device

1. Dashboard > Devices > add the device with its exact **serial number** (shown on the device under System info).
2. On the device: Comm. > Cloud Server Setting. Server address = your host, port = 80 (or 443 if the firmware supports HTTPS), enable the proxy off. The Devices page shows the exact URL and an Online badge once the device has contacted the server.
3. Employees > set each person's **Device PIN** to the user ID enrolled on the device. Punches that arrive before a PIN is linked are kept and linked automatically when you add the PIN.

## How attendance is calculated

| Rule | Behavior |
| --- | --- |
| Check-in / check-out | First and last punch of the day (repeat punches within the gap setting are merged) |
| Late | Check-in later than shift start + grace. Late minutes count from the shift start |
| Early out | Check-out earlier than shift end - early-out grace |
| Overtime | Check-out at least "overtime after" minutes past shift end. Counted from shift end |
| Absent | Working day with no punches, marked once the day is closed |
| Missing check-out | One punch only, flagged once the day is closed |
| Off day work | Punches on a weekly off or holiday count fully as overtime |

A day is closed when the date has passed, or one hour after the shift ends. Alerts are sent once per employee, kind and day.

## Structure

```
src/
  app.js, server.js        express setup, startup (migrate, first admin, scheduler)
  config/                  environment
  db/                      schema.sql, migrate, pool
  lib/                     bootstrap (first admin), attendanceEngine, dashboard queries, notify (web push), exporters, audit, settings
  middleware/              auth, roles, same-origin check
  routes/                  adms, auth, home/api, employees, users, setup (shifts, holidays, settings, audit), devices, attendance, reports, notifications
  jobs/scheduler.js        15-minute day-closing job
  views/                   EJS pages
scripts/                   create-admin, generate-vapid
public/                    css, js, service worker, manifest, icons
```

## Known limits

- Shifts must start and end on the same day. Overnight shifts are not supported yet.
- One company, one time zone (`TIMEZONE`).
- Not tested against a physical MB20 VL. ADMS field layouts differ slightly between firmware versions, so check the first real punches under Dashboard > Latest punches.

## Next phases

Leave management (requests, approval, balances) and payroll (salary, bonus, deductions, payslips with Cloudflare R2 storage) plug into the existing `employees` and `attendance` tables.
