import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AuthenticationError } from '../utils/errors.js';
import { durationToMs } from '../utils/duration.js';

const ISSUER = 'erp-platform';
const AUDIENCE = 'erp-platform-api';
const ALG = 'HS256';

/** Access token carries identity (sub) and a revocation counter (tv) only. Role/tenant/permissions are re-derived server-side per request. */
export function signAccessToken({ userId, tokenVersion }) {
  return jwt.sign({ tv: tokenVersion ?? 0 }, env.JWT_ACCESS_SECRET, {
    algorithm: ALG, expiresIn: env.JWT_ACCESS_EXPIRES_IN, issuer: ISSUER, audience: AUDIENCE, subject: String(userId),
  });
}

export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [ALG], issuer: ISSUER, audience: AUDIENCE });
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw new AuthenticationError(expired ? 'Access token expired' : 'Invalid access token', expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
  }
}

export const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');
/** Keyed hash: database contents alone cannot be used to forge or verify refresh tokens. */
export const hashRefreshToken = (token) => crypto.createHmac('sha256', env.JWT_REFRESH_SECRET).update(token).digest('hex');
export const refreshTtlMs = () => durationToMs(env.JWT_REFRESH_EXPIRES_IN);
export const newFamilyId = () => crypto.randomUUID();
