// Creates the database if it's missing, then applies src/db/schema.sql.
const fs = require('node:fs/promises');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { config } = require('../src/config');

async function main() {
  const { database, ...conn } = config.db;
  const sql = await fs.readFile(path.join(__dirname, '../src/db/schema.sql'), 'utf8');

  const connection = await mysql.createConnection({ ...conn, multipleStatements: true });
  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${database}\``);
    await connection.query(sql);
    console.log(`Migration complete: database "${database}" is up to date.`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exitCode = 1;
});
