import { query } from '../../db/pool.js';

/** Shape returned to API clients. Never includes the password hash. */
function toPublicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: Boolean(row.email_verified_at),
    createdAt: row.created_at,
  };
}

async function findByEmail(email, conn) {
  const rows = await query('SELECT * FROM users WHERE email = ? LIMIT 1', [email], conn);
  return rows[0] ?? null;
}

async function findById(id, conn) {
  const rows = await query('SELECT * FROM users WHERE id = ? LIMIT 1', [id], conn);
  return rows[0] ?? null;
}

async function create({ email, passwordHash, name }, conn) {
  const result = await query(
    'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
    [email, passwordHash, name],
    conn
  );
  return findById(result.insertId, conn);
}

async function updatePassword(id, passwordHash, conn) {
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, id], conn);
}

async function markEmailVerified(id, conn) {
  await query(
    'UPDATE users SET email_verified_at = UTC_TIMESTAMP() WHERE id = ? AND email_verified_at IS NULL',
    [id],
    conn
  );
}

async function updateRole(id, role, conn) {
  const result = await query('UPDATE users SET role = ? WHERE id = ?', [role, id], conn);
  return result.affectedRows > 0;
}

async function list({ limit, offset }) {
  // LIMIT/OFFSET are validated integers; inlined because mysql2 prepared
  // statements reject them as bound parameters on some MySQL/MariaDB versions.
  const rows = await query(
    `SELECT * FROM users ORDER BY id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
  );
  const [{ total }] = await query('SELECT COUNT(*) AS total FROM users');
  return { users: rows.map(toPublicUser), total: Number(total) };
}

export {
  toPublicUser,
  findByEmail,
  findById,
  create,
  updatePassword,
  markEmailVerified,
  updateRole,
  list,
};
