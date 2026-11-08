'use strict';
require('dotenv').config();

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

const config = {
  port: int(process.env.PORT, 3000),
  isProd: process.env.NODE_ENV === 'production',
  trustProxy: String(process.env.TRUST_PROXY || 'false') === 'true',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 3306),
    database: process.env.DB_NAME || 'student_dashboard',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASS || '',
  },
  sessionSecret: process.env.SESSION_SECRET || '',
  sessionTimeout: int(process.env.SESSION_TIMEOUT, 7200), // seconds
  maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 8),
  lockoutMinutes: int(process.env.LOCKOUT_MINUTES, 15),
};

if (!config.sessionSecret || config.sessionSecret.startsWith('change-me')) {
  if (config.isProd) {
    console.error('SESSION_SECRET must be set to a long random value in production.');
    process.exit(1);
  }
  console.warn('[warn] SESSION_SECRET is not set - using a random one (sessions reset on every restart).');
  config.sessionSecret = require('crypto').randomBytes(32).toString('hex');
}

module.exports = config;
