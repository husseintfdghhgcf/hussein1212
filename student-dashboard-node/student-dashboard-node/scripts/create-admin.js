'use strict';
// Creates the FIRST admin account (refuses to run if an admin already exists).
// Usage: npm run admin:create -- <username> <password> ["Full Name"]
const bcrypt = require('bcryptjs');
const pool = require('../src/db');
const { strChars } = require('../src/helpers');

(async () => {
  const [username, password, fullName = ''] = process.argv.slice(2);

  if (!username || !password) {
    console.error('Usage: npm run admin:create -- <username> <password> ["Full Name"]');
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_.-]{3,50}$/.test(username)) {
    console.error('Username: 3-50 characters (English letters, digits, . _ - only).');
    process.exit(1);
  }
  const pwBytes = Buffer.byteLength(password);
  if (pwBytes < 8 || pwBytes > 72) {
    console.error('Password must be between 8 and 72 characters.');
    process.exit(1);
  }
  if (strChars(fullName) > 100) {
    console.error('Full name is too long.');
    process.exit(1);
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[row]] = await conn.query('SELECT COUNT(*) AS c FROM admins FOR UPDATE');
    if (Number(row.c) > 0) {
      await conn.rollback();
      console.error('An admin already exists. Refusing to create another one from the command line.');
      process.exit(1);
    }
    await conn.execute(
      'INSERT INTO admins (username, full_name, password_hash) VALUES (?, ?, ?)',
      [username, fullName, await bcrypt.hash(password, 10)]
    );
    await conn.commit();
    console.log('Admin "%s" created. You can now sign in at /admin/login.html', username);
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
    await pool.end();
  }
})().catch((e) => {
  console.error('create-admin failed:', e.message);
  process.exit(1);
});
