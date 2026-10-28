require('express-async-errors');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const config = require('./config');
const settings = require('./lib/settings');
const { attachUser, requireAuth, sameOrigin } = require('./middleware/auth');
const { fmtDur, fmtClock } = require('./lib/time');

const app = express();
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'upgrade-insecure-requests': config.env === 'production' ? [] : null,
    },
  },
}));
app.use(compression());
if (config.env !== 'test') app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.use((req, res, next) => {
  res.locals.company = 'Attendance';
  res.locals.user = null;
  res.locals.unread = 0;
  res.locals.path = req.path;
  res.locals.ok = null;
  res.locals.err = null;
  next();
});

app.get('/healthz', (req, res) => res.type('text/plain').send('ok'));

// ZKTeco devices: raw text bodies, no cookies, no CSRF checks.
app.use('/iclock', require('./routes/adms'));

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.env === 'production' ? '1h' : 0 }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(sameOrigin);
app.use(attachUser);

const STATUS_LABEL = { present: 'On time', late: 'Late', absent: 'Absent', weekend: 'Weekly off', holiday: 'Holiday' };
app.use(async (req, res, next) => {
  const s = await settings.all();
  res.locals.company = s.company_name;
  res.locals.path = req.path;
  res.locals.fmtDur = fmtDur;
  res.locals.fmtClock = fmtClock;
  res.locals.badge = (status, fallback = 'Not in yet') => `<span class="st st-${status || 'none'}">${STATUS_LABEL[status] || fallback}</span>`;
  res.locals.ok = req.query.ok || null;
  res.locals.err = req.query.err || null;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/home'));
app.use('/', require('./routes/setup'));
app.use('/', require('./routes/attendance'));
app.use('/employees', require('./routes/employees'));
app.use('/devices', require('./routes/devices'));
app.use('/reports', require('./routes/reports'));
app.use('/notifications', require('./routes/notifications'));

app.use((req, res) => res.status(404).render('error', { title: 'Not found', code: 404, message: 'That page does not exist.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (req.originalUrl.startsWith('/api/')) return res.status(500).json({ error: 'Server error' });
  return res.status(500).render('error', { title: 'Error', code: 500, message: 'Something went wrong on our side. Try again in a moment.' });
});

module.exports = app;
