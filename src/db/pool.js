const mysql = require('mysql2/promise');
const { config } = require('../config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // Read and write DATETIME columns as UTC
  timezone: 'Z',
});

async function query(sql, params = [], conn = pool) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

/** Runs fn(conn) inside a transaction. Commits on success and rolls back on error. */
async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, withTransaction };
