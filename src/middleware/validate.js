import { AppError } from '../utils/AppError.js';

/** Validates req[source] against a zod schema and replaces it with the parsed value. */
const validate =
  (schema, source = 'body') =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      }));
      return next(AppError.badRequest('Validation failed', 'VALIDATION_ERROR', details));
    }
    if (source === 'body') req.body = result.data;
    else req.validated = { ...req.validated, [source]: result.data };
    return next();
  };

export { validate };
