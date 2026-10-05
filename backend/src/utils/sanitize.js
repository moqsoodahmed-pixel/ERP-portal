/** Recursively removes keys that could be interpreted as MongoDB operators or path traversal. */
export function sanitizeInPlace(value) {
  if (Array.isArray(value)) { value.forEach(sanitizeInPlace); return value; }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) delete value[key];
      else sanitizeInPlace(value[key]);
    }
  }
  return value;
}

const SECRET_KEY = /pass(word)?|token|secret|authorization|api[-_]?key|credential|cookie/i;
/** Deep-clones metadata with secret-looking keys removed (used by audit logging). */
export function redactSecrets(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1));
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (!SECRET_KEY.test(k)) out[k] = redactSecrets(v, depth + 1);
    return out;
  }
  return value;
}
