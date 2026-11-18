const { AppError } = require('../utils/AppError');
const { config } = require('../config');

function notFound(req, _res, next) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    err = AppError.badRequest('Malformed JSON body', 'INVALID_JSON');
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }

  console.error(err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: config.isProd ? 'Something went wrong' : err.message,
    },
  });
}

module.exports = { notFound, errorHandler };
