import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { TALLY_API_KEY_PREFIX, TALLY_CONNECTOR_SECRET_PREFIX } from '../integrations/tally/tally.constants.js';

/**
 * Tally Public API key generation/hashing. Same non-reversible pattern as the refresh token
 * (security/tokens.js hashRefreshToken): a keyed HMAC, not bcrypt (bcrypt is for human-memorable
 * passwords and cannot be looked up by hash efficiently) and not reversible encryption (a stolen database
 * alone must never yield a usable key). The HMAC key (ENCRYPTION_KEY) is a required, validated,
 * non-default-able production secret already — reused here rather than introducing a new env variable.
 */
const RAW_BYTES = 32; // 256 bits of entropy, well beyond brute-force range for an online-rate-limited API

export function generateApiKey() {
  const secret = crypto.randomBytes(RAW_BYTES).toString('base64url');
  const key = `${TALLY_API_KEY_PREFIX}${secret}`;
  // Prefix shown in list views: enough to recognise which key is which, far too short to reconstruct it.
  const keyPrefix = key.slice(0, TALLY_API_KEY_PREFIX.length + 8);
  return { key, keyPrefix };
}

export const hashApiKey = (rawKey) => crypto.createHmac('sha256', env.ENCRYPTION_KEY).update(rawKey).digest('hex');

/** Format check only — cheap, run before any DB lookup/hash so obviously-wrong input never reaches hashing. */
export const isWellFormedApiKey = (rawKey) => typeof rawKey === 'string' && rawKey.startsWith(TALLY_API_KEY_PREFIX) && rawKey.length >= TALLY_API_KEY_PREFIX.length + 32 && rawKey.length <= 200;

/**
 * Phase 16 — Tally CONNECTOR credential generation/validation. Same cryptographic primitives as the Tally
 * Public API key above (256-bit random secret, keyed-HMAC hash, never stored/returned in plaintext after
 * creation — spec Step 5), but with its own prefix so a connector secret and a Tally Public API key can
 * never be confused with one another, and `hashApiKey` (same HMAC) is reused rather than duplicated.
 */
export function generateConnectorSecret() {
  const secret = crypto.randomBytes(RAW_BYTES).toString('base64url');
  const key = `${TALLY_CONNECTOR_SECRET_PREFIX}${secret}`;
  const secretPrefix = key.slice(0, TALLY_CONNECTOR_SECRET_PREFIX.length + 8);
  return { key, secretPrefix };
}

export const isWellFormedConnectorSecret = (rawKey) => typeof rawKey === 'string'
  && rawKey.startsWith(TALLY_CONNECTOR_SECRET_PREFIX)
  && rawKey.length >= TALLY_CONNECTOR_SECRET_PREFIX.length + 32
  && rawKey.length <= 200;
