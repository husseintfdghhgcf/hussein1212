'use strict';
// Creates the database + tables + sample data from database/database.sql
// Usage: npm run db:init
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

(async () => {
  const sqlFile = path.join(__dirname, '..', 'database', 'database.sql');
  let sql = fs.readFileSync(sqlFile, 'utf8');

  // The SQL file hard-codes the database name; make it follow DB_NAME from .env
  sql = sql.replace(/`student_dashboard`/g, '`' + config.db.database.replace(/`/g, '') + '`');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    charset: 'utf8mb4',
    multipleStatements: true,
  });
  try {
    await conn.query(sql);
    console.log('Database "%s" is ready (tables + sample data).', config.db.database);
    console.log('Sample students use the temporary password: Student@2026');
    console.log('Next step: npm run admin:create -- <username> <password> ["Full Name"]');
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error('init-db failed:', e.message);
  process.exit(1);
});
