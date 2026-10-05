import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const ALGO = 'aes-256-gcm';
const VERSION = 'v1';

function loadKey(b64) {
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes, base64 encoded');
  return key;
}
const keyId = (key) => crypto.createHash('sha256').update(key).digest('hex').slice(0, 8);

/**
 * AES-256-GCM field encryption. Format: v1.<keyId>.<iv>.<tag>.<ciphertext> (base64url).
 * The keyId lets ENCRYPTION_KEY_PREVIOUS decrypt old values during key rotation.
 */
export class EncryptionService {
  constructor({ currentKey = env.ENCRYPTION_KEY, previousKey = env.ENCRYPTION_KEY_PREVIOUS } = {}) {
    this.keys = new Map();
    const cur = loadKey(currentKey);
    this.currentId = keyId(cur);
    this.keys.set(this.currentId, cur);
    if (previousKey) { const prev = loadKey(previousKey); this.keys.set(keyId(prev), prev); }
  }

  encrypt(plaintext) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, this.keys.get(this.currentId), iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    return [VERSION, this.currentId, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
  }

  decrypt(payload) {
    try {
      const [version, id, iv, tag, ct] = String(payload).split('.');
      const key = this.keys.get(id);
      if (version !== VERSION || !key) throw new Error('unknown version or key');
      const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      throw new AppError('DECRYPTION_FAILED', 'Stored value could not be decrypted', 500);
    }
  }

  needsRotation(payload) { return String(payload).split('.')[1] !== this.currentId; }
}
