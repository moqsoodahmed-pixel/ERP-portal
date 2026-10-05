/**
 * Phase 16 — Windows Tally Connector configuration (spec Step 32). Everything is env/config-driven —
 * nothing here is ever hard-coded (ERP URL, credential, polling interval, local Tally host/port, company,
 * timeout, retry, logging). See .env.example for the full list and defaults.
 */
function num(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function bool(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v === 'true' || v === '1';
}

export function loadConfig(env = process.env) {
  const erpBaseUrl = env.ERP_BASE_URL ?? 'http://localhost:4000';
  const connectorSecret = env.TALLY_CONNECTOR_SECRET ?? '';
  return {
    erpBaseUrl: erpBaseUrl.replace(/\/$/, ''),
    connectorSecret,
    pollIntervalMs: num('POLL_INTERVAL_MS', 10_000),
    heartbeatIntervalMs: num('HEARTBEAT_INTERVAL_MS', 30_000),
    requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 10_000),
    maxRetries: num('MAX_RETRIES', 3),
    retryBackoffMs: num('RETRY_BACKOFF_MS', 2_000),
    // Local TallyPrime connection (same XML-over-HTTP mechanism as backend/src/integrations/tally/tally.client.js
    // — no new protocol invented, spec Step 33).
    tally: {
      mode: env.TALLY_MODE ?? 'mock', // 'mock' (default; no real TallyPrime reachable in this environment) | 'http'
      host: env.TALLY_HOST ?? '127.0.0.1',
      port: num('TALLY_PORT', 9000),
      companyName: env.TALLY_COMPANY_NAME ?? '',
      timeoutMs: num('TALLY_TIMEOUT_MS', 10_000),
    },
    connectorName: env.CONNECTOR_NAME ?? 'unnamed-connector',
    connectorVersion: env.CONNECTOR_VERSION ?? '0.1.0',
    logLevel: env.LOG_LEVEL ?? 'info',
    logToFile: bool('LOG_TO_FILE', false),
    logFilePath: env.LOG_FILE_PATH ?? './connector.log',
  };
}
