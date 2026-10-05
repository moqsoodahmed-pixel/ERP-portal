import { errorBody } from '../utils/response.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json(errorBody(req, 'NOT_FOUND', 'Route not found'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500; let code = 'INTERNAL_ERROR'; let message = 'An unexpected error occurred'; let details = [];

  if (err instanceof AppError) { ({ statusCode: status, code, message } = err); details = err.details ?? []; }
  else if (err?.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body is too large'; }
  else if (err?.type === 'entity.parse.failed') { status = 400; code = 'VALIDATION_ERROR'; message = 'Malformed JSON body'; }
  else if (err?.code === 11000) { status = 409; code = 'CONFLICT'; message = 'A record with the same unique value already exists'; }
  else if (err?.name === 'ValidationError' || err?.name === 'CastError') { status = 400; code = 'VALIDATION_ERROR'; message = 'Invalid request'; }

  if (status >= 500) {
    logger.error({ event: 'http.error', requestId: req.id, userId: req.auth?.userId, tenantId: req.tenantId, err: { name: err?.name, message: err?.message, stack: err?.stack } }, 'Unhandled error');
  }
  const exposeDetails = status < 500 || !env.isProd;
  res.status(status).json(errorBody(req, code, message, exposeDetails ? details : []));
}
