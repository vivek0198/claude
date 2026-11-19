import { AppError } from '../utils/AppError.js';

/**
 * Restricts a route to the given roles. Use after authenticate:
 *   router.get('/admin', authenticate, authorize('admin'), handler)
 */
const authorize =
  (...roles) =>
  (req, _res, next) => {
    if (!req.user) return next(AppError.unauthorized());
    if (!roles.includes(req.user.role)) return next(AppError.forbidden());
    return next();
  };

export { authorize };
