const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { config } = require('../config');

const base = {
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Keep the automated test suite free of rate-limit flakiness
  skip: () => config.env === 'test',
  handler: (_req, res, _next, options) =>
    res.status(options.statusCode).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later.' },
    }),
};

const emailKey = (req) =>
  `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').trim().toLowerCase()}`;

/** Failed logins: 5 per 15 min per IP + email. Successful logins don't count. */
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: emailKey,
});

/** Registration: 10 per hour per IP. */
const registerLimiter = rateLimit({ ...base, windowMs: 60 * 60 * 1000, limit: 10 });

/** Emails sent on request (reset/verification): 3 per hour per IP + email. */
const emailLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: emailKey,
});

/** General limit for the rest of /api/auth: 100 per 15 min per IP. */
const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 100 });

module.exports = { loginLimiter, registerLimiter, emailLimiter, authLimiter };
