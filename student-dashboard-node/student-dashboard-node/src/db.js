'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

// One shared pool. Every query uses placeholders (prepared statements).
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
});

module.exports = pool;
