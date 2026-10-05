import { logger } from '../utils/logger.js';

export function httpLogger(req, res, next) {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info({
      event: 'http.request', requestId: req.id, method: req.method, path: req.path, status: res.statusCode,
      durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n), userId: req.auth?.userId, tenantId: req.tenantId,
    });
  });
  next();
}
