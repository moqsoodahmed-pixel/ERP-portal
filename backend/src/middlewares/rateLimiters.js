import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { RATE_LIMITS } from '../config/rateLimits.js';
import { env } from '../config/env.js';
import { RateLimitError } from '../utils/errors.js';

export function createRateLimiters(overrides = {}, { securityService } = {}) {
  const make = (name) => {
    const cfg = { ...RATE_LIMITS[name], ...(overrides[name] ?? {}) };
    if (env.RATE_LIMIT_DISABLED && !overrides[name]) return (req, res, next) => next();
    return rateLimit({
      windowMs: cfg.windowMs, limit: cfg.max, standardHeaders: 'draft-7', legacyHeaders: false,
      // Phase 13: the Tally Public API has no session/user to key on, so it's rate-limited by the
      // presented API key (one tenant's integration traffic cannot exhaust another's budget) with IP as
      // a secondary fallback for requests that omit the header entirely (caught by auth anyway, but still
      // worth bucketing separately from real keys).
      keyGenerator: name === 'tallyPublicApi'
        ? (req) => (req.get('x-tally-api-key') ? `key:${req.get('x-tally-api-key').slice(0, 24)}` : `ip:${ipKeyGenerator(req.ip)}`)
        // Phase 16: keyed by the connector's OWN resolved identity (set by tallyConnectorAuth.authenticate
        // before this limiter in the middleware chain is irrelevant here — we key on the raw presented
        // secret's prefix, same non-reversible-but-stable approach as the Tally Public API limiter above,
        // so one connector cannot exhaust another connector's or the platform's budget).
        : name === 'tallyConnector'
          ? (req) => (req.get('x-tally-connector-secret') ? `conn:${req.get('x-tally-connector-secret').slice(0, 24)}` : `ip:${ipKeyGenerator(req.ip)}`)
          : undefined,
      handler: (req, res, next) => {
        securityService?.record('RATE_LIMIT_TRIGGERED', { ip: req.ip, requestId: req.id, userAgent: req.get('user-agent') }, { severity: 'LOW', details: { limiter: name } });
        next(new RateLimitError());
      },
    });
  };
  return Object.fromEntries(Object.keys(RATE_LIMITS).map((k) => [k, make(k)]));
}