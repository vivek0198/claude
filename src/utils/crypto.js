const crypto = require('node:crypto');

/** URL-safe random token (256 bits). */
const randomToken = () => crypto.randomBytes(32).toString('base64url');

/** Tokens are stored hashed, so a database leak doesn't expose usable tokens. */
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

module.exports = { randomToken, sha256 };
