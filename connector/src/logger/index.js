import fs from 'node:fs';

/**
 * Minimal structured logger. CRITICAL (spec Step 22): NEVER logs the connector secret, any Authorization/
 * X-Tally-Connector-Secret header value, or raw Tally credentials. `redact()` is applied to every object
 * logged as a defence-in-depth measure, mirroring the backend's utils/sanitize.js approach.
 */
const SECRET_KEY_PATTERN = /secret|password|token|authorization|credential/i;

function redact(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redact);
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SECRET_KEY_PATTERN.test(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

export function createLogger({ logToFile = false, logFilePath = './connector.log' } = {}) {
  const write = (level, message, meta) => {
    const line = JSON.stringify({
      ts: new Date().toISOString(), level, message, ...(meta ? { meta: redact(meta) } : {}),
    });
    // eslint-disable-next-line no-console
    console[level === 'error' ? 'error' : 'log'](line);
    if (logToFile) {
      try { fs.appendFileSync(logFilePath, `${line}\n`); } catch { /* best-effort file logging only */ }
    }
  };
  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export { redact };
