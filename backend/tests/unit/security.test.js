import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signAccessToken, verifyAccessToken, hashRefreshToken, generateRefreshToken } from '../../src/security/tokens.js';
import { EncryptionService } from '../../src/security/encryption.js';
import { sanitizeInPlace, redactSecrets } from '../../src/utils/sanitize.js';
import { serialize } from '../../src/utils/serialize.js';

test('valid access token verifies; carries only sub + tv', () => {
  const p = verifyAccessToken(signAccessToken({ userId: 'abc', tokenVersion: 2 }));
  assert.equal(p.sub, 'abc'); assert.equal(p.tv, 2); assert.equal(p.role, undefined); assert.equal(p.tenantId, undefined);
});
test('expired token -> TOKEN_EXPIRED', () => {
  const t = jwt.sign({ tv: 0 }, process.env.JWT_ACCESS_SECRET, { expiresIn: -10, issuer: 'erp-platform', audience: 'erp-platform-api', subject: 'x' });
  assert.throws(() => verifyAccessToken(t), (e) => e.code === 'TOKEN_EXPIRED');
});
test('wrong secret, alg=none, wrong audience are all rejected', () => {
  const opts = { issuer: 'erp-platform', audience: 'erp-platform-api', subject: 'x' };
  assert.throws(() => verifyAccessToken(jwt.sign({ tv: 0 }, 'a-completely-different-secret-value-123456', opts)), (e) => e.code === 'TOKEN_INVALID');
  assert.throws(() => verifyAccessToken(jwt.sign({ tv: 0 }, '', { ...opts, algorithm: 'none' })), (e) => e.code === 'TOKEN_INVALID');
  assert.throws(() => verifyAccessToken(jwt.sign({ tv: 0 }, process.env.JWT_ACCESS_SECRET, { ...opts, audience: 'other' })), (e) => e.code === 'TOKEN_INVALID');
  assert.throws(() => verifyAccessToken('garbage'), (e) => e.code === 'TOKEN_INVALID');
});
test('refresh tokens are random and stored only as keyed hashes', () => {
  const a = generateRefreshToken(); const b = generateRefreshToken();
  assert.notEqual(a, b); assert.notEqual(hashRefreshToken(a), a); assert.equal(hashRefreshToken(a), hashRefreshToken(a));
});
test('encryption round-trips, is non-deterministic, detects tampering', () => {
  const enc = new EncryptionService();
  const c1 = enc.encrypt('secret'); const c2 = enc.encrypt('secret');
  assert.notEqual(c1, c2); assert.equal(enc.decrypt(c1), 'secret');
  const parts = c1.split('.'); parts[4] = Buffer.from('tampered').toString('base64url');
  assert.throws(() => enc.decrypt(parts.join('.')), (e) => e.code === 'DECRYPTION_FAILED');
});
test('key rotation: previous key still decrypts, needsRotation flags old ciphertext', () => {
  const k1 = Buffer.alloc(32, 1).toString('base64'); const k2 = Buffer.alloc(32, 2).toString('base64');
  const old = new EncryptionService({ currentKey: k1, previousKey: '' }).encrypt('v');
  const rotated = new EncryptionService({ currentKey: k2, previousKey: k1 });
  assert.equal(rotated.decrypt(old), 'v'); assert.equal(rotated.needsRotation(old), true);
  assert.equal(rotated.needsRotation(rotated.encrypt('v')), false);
  assert.throws(() => new EncryptionService({ currentKey: k2, previousKey: '' }).decrypt(old));
});
test('sanitizeInPlace strips $operators and dotted keys', () => {
  const o = { email: { $ne: null }, a: { 'b.c': 1, ok: 2 }, list: [{ $where: 'x', y: 1 }] };
  sanitizeInPlace(o);
  assert.deepEqual(o, { email: {}, a: { ok: 2 }, list: [{ y: 1 }] });
});
test('redactSecrets + serialize never leak secret-looking fields', () => {
  assert.deepEqual(redactSecrets({ a: 1, password: 'x', nested: { refreshToken: 't', ok: true }, apiKey: 'k' }), { a: 1, nested: { ok: true } });
  const out = serialize({ name: 'n', passwordHash: 'h', tokenHash: 't', credentialsEncrypted: 'c', inner: { secret: 's', fine: 1 } });
  assert.deepEqual(out, { name: 'n', inner: { fine: 1 } });
});
