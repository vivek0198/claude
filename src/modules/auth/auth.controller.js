const { config } = require('../../config');
const auth = require('./auth.service');

const REFRESH_COOKIE = 'refreshToken';

const cookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  // Only sent to the auth endpoints that need it
  path: '/api/auth',
};

const requestMeta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

const readRefreshToken = (req) => req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;

/** Sets the refresh cookie and returns the session body (the refresh token stays in the cookie only). */
function sendSession(res, session, status = 200) {
  res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, expires: session.refreshTokenExpiresAt });
  return res.status(status).json({ user: session.user, accessToken: session.accessToken });
}

async function register(req, res) {
  const user = await auth.register(req.body);
  res.status(201).json({
    user,
    message: 'Account created. Check your email to verify your address.',
  });
}

async function login(req, res) {
  sendSession(res, await auth.login(req.body, requestMeta(req)));
}

async function refresh(req, res) {
  try {
    sendSession(res, await auth.refresh(readRefreshToken(req), requestMeta(req)));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw err;
  }
}

async function logout(req, res) {
  await auth.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
}

async function logoutAll(req, res) {
  await auth.logoutAll(req.user.id);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
}

async function me(req, res) {
  res.json({ user: await auth.getCurrentUser(req.user.id) });
}

async function verifyEmail(req, res) {
  await auth.verifyEmail(req.body.token);
  res.json({ message: 'Email verified. You can now sign in.' });
}

async function resendVerification(req, res) {
  await auth.resendVerification(req.body.email);
  res.json({ message: 'If that account exists and is unverified, a new verification email has been sent.' });
}

async function forgotPassword(req, res) {
  await auth.forgotPassword(req.body.email);
  res.json({ message: 'If an account exists for that email, a reset link has been sent.' });
}

async function resetPassword(req, res) {
  await auth.resetPassword(req.body);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.json({ message: 'Password updated. Please sign in with your new password.' });
}

async function changePassword(req, res) {
  sendSession(res, await auth.changePassword(req.user.id, req.body, requestMeta(req)));
}

module.exports = {
  REFRESH_COOKIE,
  register,
  login,
  refresh,
  logout,
  logoutAll,
  me,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
};
