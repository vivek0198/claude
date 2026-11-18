const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../../config');
const { query, withTransaction } = require('../../db/pool');
const { randomToken, sha256 } = require('../../utils/crypto');
const { AppError } = require('../../utils/AppError');

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Access tokens (short-lived, stateless JWTs)
// ---------------------------------------------------------------------------

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, config.jwt.accessSecret, {
    subject: String(user.id),
    expiresIn: config.jwt.accessExpiresIn,
    algorithm: 'HS256',
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret, { algorithms: ['HS256'] });
}

// ---------------------------------------------------------------------------
// Refresh tokens (opaque, stored hashed, rotated on every use)
// ---------------------------------------------------------------------------

const truncate = (s, n) => (s ? String(s).slice(0, n) : null);

async function issueRefreshToken(userId, meta = {}, familyId = crypto.randomUUID(), conn) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * DAY_MS);
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, sha256(token), familyId, expiresAt, truncate(meta.userAgent, 255), truncate(meta.ip, 45)],
    conn
  );
  return { token, expiresAt };
}

/**
 * Exchanges a refresh token for a new one in the same family.
 * Presenting an already-revoked token revokes the whole family, because it
 * means the token was copied and someone else has already used it.
 */
async function rotateRefreshToken(rawToken, meta = {}) {
  const outcome = await withTransaction(async (conn) => {
    const [row] = await query(
      'SELECT * FROM refresh_tokens WHERE token_hash = ? FOR UPDATE',
      [sha256(rawToken)],
      conn
    );
    if (!row) return { error: 'INVALID' };

    if (row.revoked_at) {
      await revokeFamily(row.family_id, conn);
      return { error: 'REUSED' };
    }
    if (row.expires_at <= new Date()) return { error: 'EXPIRED' };

    await query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [row.id], conn);
    const next = await issueRefreshToken(row.user_id, meta, row.family_id, conn);
    return { userId: row.user_id, ...next };
  });

  // Thrown outside the transaction so the family revocation above is committed.
  if (outcome.error === 'REUSED') {
    throw AppError.unauthorized('Refresh token reuse detected; please sign in again', 'TOKEN_REUSED');
  }
  if (outcome.error) {
    throw AppError.unauthorized('Invalid or expired refresh token', 'INVALID_REFRESH_TOKEN');
  }
  return outcome;
}

async function revokeFamily(familyId, conn) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE family_id = ? AND revoked_at IS NULL',
    [familyId],
    conn
  );
}

/** Revokes the session (token family) a refresh token belongs to. No-op for unknown tokens. */
async function revokeByToken(rawToken) {
  const [row] = await query('SELECT family_id FROM refresh_tokens WHERE token_hash = ?', [sha256(rawToken)]);
  if (row) await revokeFamily(row.family_id);
}

async function revokeAllForUser(userId, conn) {
  await query(
    'UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL',
    [userId],
    conn
  );
}

// ---------------------------------------------------------------------------
// Single-use tokens (email verification, password reset)
// ---------------------------------------------------------------------------

const TOKEN_TYPES = {
  EMAIL_VERIFICATION: { type: 'email_verification', ttlMs: DAY_MS },
  PASSWORD_RESET: { type: 'password_reset', ttlMs: 60 * 60 * 1000 },
};

/** Creates a new single-use token and invalidates any earlier unused one of the same type. */
async function createUserToken(userId, { type, ttlMs }, conn) {
  await query(
    'UPDATE user_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND type = ? AND used_at IS NULL',
    [userId, type],
    conn
  );
  const token = randomToken();
  await query(
    'INSERT INTO user_tokens (user_id, type, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [userId, type, sha256(token), new Date(Date.now() + ttlMs)],
    conn
  );
  return token;
}

/** Marks a valid token as used and returns its user id, or null if it's invalid, used or expired. */
async function consumeUserToken(rawToken, { type }, conn) {
  const [row] = await query(
    `SELECT id, user_id FROM user_tokens
     WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()
     FOR UPDATE`,
    [sha256(rawToken), type],
    conn
  );
  if (!row) return null;
  await query('UPDATE user_tokens SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id], conn);
  return row.user_id;
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeFamily,
  revokeByToken,
  revokeAllForUser,
  TOKEN_TYPES,
  createUserToken,
  consumeUserToken,
};
