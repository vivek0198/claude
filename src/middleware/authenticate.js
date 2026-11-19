import { verifyAccessToken } from '../modules/auth/token.service.js';
import { AppError } from '../utils/AppError.js';

/**
 * Requires a valid access token in "Authorization: Bearer <token>".
 * Sets req.user = { id, role }.
 */
function authenticate(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return next(AppError.unauthorized());
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: Number(payload.sub), role: payload.role };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(AppError.unauthorized('Access token expired', 'TOKEN_EXPIRED'));
    }
    return next(AppError.unauthorized('Invalid access token', 'INVALID_TOKEN'));
  }
}

export { authenticate };
