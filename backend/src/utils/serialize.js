const SENSITIVE_KEYS = new Set([
  'password', 'passwordHash', 'tokenHash', 'replacedByHash', 'refreshToken',
  'secret', 'apiKey', 'credentials', 'credentialsEncrypted', 'encryptionKey', '__v',
]);

/** Converts DB values to JSON-safe values and strips secrets (defence in depth for every response). */
export function serialize(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serialize);
  if (value instanceof Date) return value;
  if (typeof value !== 'object') return value;
  if (['Decimal128', 'ObjectId', 'ObjectID'].includes(value._bsontype)) return value.toString();
  if (value instanceof Set) return [...value];
  if (typeof value.toObject === 'function') return serialize(value.toObject());
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.has(k)) out[k] = serialize(v);
  }
  return out;
}
