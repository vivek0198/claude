const bcrypt = require('bcryptjs');
const { config } = require('../../config');
const { withTransaction } = require('../../db/pool');
const { AppError } = require('../../utils/AppError');
const { sendMail } = require('../../utils/mailer');
const users = require('../users/user.repository');
const {
  TOKEN_TYPES,
  consumeUserToken,
  createUserToken,
  issueRefreshToken,
  revokeAllForUser,
  revokeByToken,
  rotateRefreshToken,
  signAccessToken,
} = require('./token.service');

const BCRYPT_ROUNDS = config.env === 'test' ? 4 : 12;

// Compared against when the email doesn't exist, so a login for an unknown
// email takes about as long as one for a known email (prevents user enumeration).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

async function startSession(user, meta) {
  const refresh = await issueRefreshToken(user.id, meta);
  return {
    user: users.toPublicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}

async function sendVerificationEmail(user) {
  const token = await createUserToken(user.id, TOKEN_TYPES.EMAIL_VERIFICATION);
  const link = `${config.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Verify your email address',
    text: `Hi ${user.name},\n\nConfirm your email address by opening this link:\n${link}\n\nThe link expires in 24 hours.`,
  });
}

async function register({ email, password, name }) {
  if (await users.findByEmail(email)) {
    throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await users.create({ email, passwordHash, name });
  } catch (err) {
    // Two registrations for the same email at once: the unique index catches the second
    if (err.code === 'ER_DUP_ENTRY') {
      throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    }
    throw err;
  }

  await sendVerificationEmail(user);
  return users.toPublicUser(user);
}

async function login({ email, password }, meta) {
  const user = await users.findByEmail(email);
  const valid = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) {
    throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  if (config.requireEmailVerification && !user.email_verified_at) {
    throw AppError.forbidden('Please verify your email address before signing in', 'EMAIL_NOT_VERIFIED');
  }
  return startSession(user, meta);
}

async function refresh(rawToken, meta) {
  if (!rawToken) throw AppError.unauthorized('Refresh token missing', 'INVALID_REFRESH_TOKEN');

  const rotated = await rotateRefreshToken(rawToken, meta);
  const user = await users.findById(rotated.userId);
  if (!user) throw AppError.unauthorized('Account no longer exists', 'INVALID_REFRESH_TOKEN');

  return {
    user: users.toPublicUser(user),
    accessToken: signAccessToken(user),
    refreshToken: rotated.token,
    refreshTokenExpiresAt: rotated.expiresAt,
  };
}

async function logout(rawToken) {
  if (rawToken) await revokeByToken(rawToken);
}

async function logoutAll(userId) {
  await revokeAllForUser(userId);
}

async function getCurrentUser(userId) {
  const user = await users.findById(userId);
  if (!user) throw AppError.notFound('User not found');
  return users.toPublicUser(user);
}

async function verifyEmail(token) {
  const verified = await withTransaction(async (conn) => {
    const userId = await consumeUserToken(token, TOKEN_TYPES.EMAIL_VERIFICATION, conn);
    if (!userId) return false;
    await users.markEmailVerified(userId, conn);
    return true;
  });
  if (!verified) throw AppError.badRequest('Invalid or expired verification link', 'INVALID_TOKEN');
}

/** Always succeeds from the caller's view so it can't be used to find out which emails exist. */
async function resendVerification(email) {
  const user = await users.findByEmail(email);
  if (user && !user.email_verified_at) await sendVerificationEmail(user);
}

/** Always succeeds from the caller's view so it can't be used to find out which emails exist. */
async function forgotPassword(email) {
  const user = await users.findByEmail(email);
  if (!user) return;

  const token = await createUserToken(user.id, TOKEN_TYPES.PASSWORD_RESET);
  const link = `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: 'Reset your password',
    text: `Hi ${user.name},\n\nReset your password by opening this link:\n${link}\n\nThe link expires in 1 hour. If you didn't ask for this, you can ignore this email.`,
  });
}

async function resetPassword({ token, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const ok = await withTransaction(async (conn) => {
    const userId = await consumeUserToken(token, TOKEN_TYPES.PASSWORD_RESET, conn);
    if (!userId) return false;
    await users.updatePassword(userId, passwordHash, conn);
    // Receiving the reset email proves the user owns the address
    await users.markEmailVerified(userId, conn);
    // Sign out every existing session
    await revokeAllForUser(userId, conn);
    return true;
  });
  if (!ok) throw AppError.badRequest('Invalid or expired reset link', 'INVALID_TOKEN');
}

/** Changes the password, signs out all sessions, and returns a fresh session for the caller. */
async function changePassword(userId, { currentPassword, newPassword }, meta) {
  const user = await users.findById(userId);
  if (!user) throw AppError.notFound('User not found');
  if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
    throw AppError.badRequest('Current password is incorrect', 'INVALID_CREDENTIALS');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await withTransaction(async (conn) => {
    await users.updatePassword(userId, passwordHash, conn);
    await revokeAllForUser(userId, conn);
  });
  return startSession(user, meta);
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getCurrentUser,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
};
