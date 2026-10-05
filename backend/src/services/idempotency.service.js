import crypto from 'node:crypto';
import { ConflictError, ValidationError } from '../utils/errors.js';

const TTL_MS = 24 * 60 * 60 * 1000;

/** Express middleware factory. Replays the stored response for a repeated (tenant, scope, Idempotency-Key). */
export const idempotency = (repo, scope) => async (req, res, next) => {
  const key = req.get('idempotency-key');
  if (!key) return next();
  if (!/^[\w-]{8,128}$/.test(key)) return next(new ValidationError('Idempotency-Key must be 8-128 characters of [A-Za-z0-9_-]'));
  const requestHash = crypto.createHash('sha256').update(`${req.method}:${scope}:${JSON.stringify(req.body ?? {})}`).digest('hex');
  const scoped = `${scope}:${req.auth.userId}`;
  try {
    const record = await repo.reserve({ tenantId: req.tenantId, scope: scoped, key, requestHash, expiresAt: new Date(Date.now() + TTL_MS) });
    const original = res.json.bind(res);
    res.json = (body) => {
      const done = res.statusCode >= 200 && res.statusCode < 300 ? repo.complete(record._id, res.statusCode, body) : repo.release(record._id);
      Promise.resolve(done).catch(() => {});
      return original(body);
    };
    return next();
  } catch (err) {
    if (err.code !== 11000) return next(err);
    const existing = await repo.find(req.tenantId, scoped, key);
    if (!existing) return next(new ConflictError('Please retry the request', 'IDEMPOTENCY_RETRY'));
    if (existing.requestHash !== requestHash) return next(new ConflictError('Idempotency-Key was already used with a different request', 'IDEMPOTENCY_KEY_REUSED'));
    if (existing.status !== 'COMPLETED') return next(new ConflictError('A request with this key is still in progress', 'IDEMPOTENCY_IN_PROGRESS'));
    res.set('Idempotent-Replay', 'true');
    return res.status(existing.responseStatus).json(existing.responseBody);
  }
};
