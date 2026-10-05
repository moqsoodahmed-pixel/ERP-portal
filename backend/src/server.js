import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { models } from './models/index.js';
import { buildContainer } from './container.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';
import { startTallyConnectorOfflineMonitor } from './jobs/tallyConnectorOfflineMonitor.js';

try {
  await connectDatabase();
} catch (err) {
  logger.fatal({ event: 'db.connect_failed', err: err.message }, 'Cannot connect to MongoDB; exiting');
  process.exit(1);
}
const container = buildContainer(models);
const app = createApp(container);
const server = app.listen(env.PORT, () => logger.info({ event: 'server.started', port: env.PORT, env: env.NODE_ENV }, 'API listening'));

// Phase 16.1: single-instance in-process offline monitor (see jobs/tallyConnectorOfflineMonitor.js for the assumption).
const offlineMonitor = startTallyConnectorOfflineMonitor({
  tallyConnectorService: container.services.tallyConnectorService,
  intervalMs: env.TALLY_CONNECTOR_MONITOR_INTERVAL_SECONDS * 1000,
  thresholdMs: env.TALLY_CONNECTOR_OFFLINE_AFTER_SECONDS * 1000,
});

const shutdown = (signal) => {
  logger.info({ event: 'server.shutdown', signal }, 'Shutting down');
  offlineMonitor.stop();
  server.close(async () => { await disconnectDatabase(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
};
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => shutdown(s)));
