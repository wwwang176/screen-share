const fs = require('fs');
const path = require('path');
const pool = require('./index');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
  await pool.query(sql);
  console.log('Database migration completed');
}

module.exports = migrate;
