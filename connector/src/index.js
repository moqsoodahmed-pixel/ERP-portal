import { loadConfig } from './config/index.js';
import { createLogger } from './logger/index.js';
import { ErpClient } from './api/erpClient.js';
import { LocalTallyAdapter } from './tally/localTallyAdapter.js';
import { JobRunner } from './jobs/runner.js';

/**
 * Phase 16 — Windows Tally Connector entrypoint (Side B). A separate, standalone Node.js process — NOT
 * part of the ERP Express monolith, NOT reachable from the public internet, and NOT a microservice split
 * of the ERP (the ERP stays a modular monolith). It only ever initiates OUTBOUND connections: to the ERP
 * cloud (poll/claim/report) and to a local TallyPrime instance (never the reverse — spec Step 1/2).
 */
export function createConnector(env = process.env) {
  const config = loadConfig(env);
  const logger = createLogger(config);
  if (!config.connectorSecret) {
    logger.error('TALLY_CONNECTOR_SECRET is not set — refusing to start. See .env.example.');
    throw new Error('Missing TALLY_CONNECTOR_SECRET');
  }
  const erpClient = new ErpClient({
    baseUrl: config.erpBaseUrl, connectorSecret: config.connectorSecret, timeoutMs: config.requestTimeoutMs, logger,
  });
  const tallyAdapter = new LocalTallyAdapter({
    mode: config.tally.mode, host: config.tally.host, port: config.tally.port, companyName: config.tally.companyName, timeoutMs: config.tally.timeoutMs, logger,
  });
  const runner = new JobRunner({
    erpClient, tallyAdapter, logger, pollIntervalMs: config.pollIntervalMs, heartbeatIntervalMs: config.heartbeatIntervalMs, connectorVersion: config.connectorVersion,
  });
  return {
    config, logger, erpClient, tallyAdapter, runner,
  };
}

/* c8 ignore start -- process entrypoint, exercised by integration use, not unit tests */
if (import.meta.url === `file://${process.argv[1]}`) {
  const { logger, runner } = createConnector();
  logger.info('Tally Connector starting', { mode: 'see TALLY_MODE env var' });
  runner.start();
  process.on('SIGINT', () => { runner.stop(); process.exit(0); });
  process.on('SIGTERM', () => { runner.stop(); process.exit(0); });
}
/* c8 ignore stop */
