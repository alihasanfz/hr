require('dotenv').config();
const env = process.env;

const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  dbSsl: /sslmode=require/.test(env.DATABASE_URL || '') || env.DATABASE_SSL === 'true',
  jwtSecret: env.JWT_SECRET || 'dev-only-change-me',
  companyName: env.COMPANY_NAME || 'Attendance System',
  tz: env.TIMEZONE || 'Asia/Dhaka',
  autoMigrate: env.AUTO_MIGRATE !== 'false',
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY || '',
    privateKey: env.VAPID_PRIVATE_KEY || '',
    subject: env.VAPID_SUBJECT || '',
  },
};

if (!config.databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and fill it in.');
if (config.env === 'production' && config.jwtSecret === 'dev-only-change-me') {
  throw new Error('JWT_SECRET must be set in production.');
}

module.exports = config;
