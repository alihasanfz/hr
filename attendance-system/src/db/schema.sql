CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','hr','staff')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 10,
  early_out_grace_minutes INT NOT NULL DEFAULT 0,
  overtime_after_minutes INT NOT NULL DEFAULT 30,
  weekly_off INT[] NOT NULL DEFAULT '{5}',
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  emp_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  department TEXT,
  designation TEXT,
  phone TEXT,
  device_user_id TEXT UNIQUE,
  shift_id INT REFERENCES shifts(id) ON DELETE SET NULL,
  join_date DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  serial_number TEXT UNIQUE NOT NULL,
  model TEXT NOT NULL DEFAULT 'ZKTeco MB20 VL',
  ip_address TEXT,
  port INT NOT NULL DEFAULT 4370,
  api_url TEXT,
  location TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_stamp TEXT,
  last_seen_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS punches (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  device_id INT REFERENCES devices(id) ON DELETE SET NULL,
  device_user_id TEXT NOT NULL,
  punch_time TIMESTAMP NOT NULL,
  status_code INT,
  verify_mode INT,
  source TEXT NOT NULL DEFAULT 'device',
  note TEXT,
  created_by INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_user_id, punch_time)
);
CREATE INDEX IF NOT EXISTS idx_punches_emp_time ON punches (employee_id, punch_time);
CREATE INDEX IF NOT EXISTS idx_punches_time ON punches (punch_time DESC);

CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  shift_id INT REFERENCES shifts(id) ON DELETE SET NULL,
  check_in TIMESTAMP,
  check_out TIMESTAMP,
  status TEXT NOT NULL CHECK (status IN ('present','late','absent','weekend','holiday')),
  late_minutes INT NOT NULL DEFAULT 0,
  early_out_minutes INT NOT NULL DEFAULT 0,
  overtime_minutes INT NOT NULL DEFAULT 0,
  work_minutes INT NOT NULL DEFAULT 0,
  punch_count INT NOT NULL DEFAULT 0,
  missing_punch BOOLEAN NOT NULL DEFAULT FALSE,
  remarks TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance (work_date);

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  holiday_date DATE UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  employee_id INT REFERENCES employees(id) ON DELETE CASCADE,
  work_date DATE,
  title TEXT NOT NULL,
  body TEXT,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, employee_id, work_date)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT UNIQUE NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
