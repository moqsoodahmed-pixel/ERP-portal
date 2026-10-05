import { logger } from '../utils/logger.js';

/**
 * Phase 16.1 — scheduled offline monitor (spec Step 4).
 *
 * SINGLE-INSTANCE ASSUMPTION: this is a plain `setInterval` running in-process. It is safe as long as
 * exactly one backend instance runs it. If the API is ever scaled to multiple instances, every instance
 * would run its own sweep concurrently; that is still functionally harmless (each transition is guarded
 * by an atomic, status-conditional `findOneAndUpdate` in the repository, so at most one instance's write
 * actually lands and gets audited per connector), but it does mean N instances each poll Mongo on the
 * same interval. No distributed lock/leader-election is implemented — out of scope for this phase and
 * unnecessary for the current single-instance deployment. A future multi-instance deployment should add
 * one (e.g. a leader lease document) before relying on this for anything latency-sensitive.
 *
 * Overlap guard: `running` prevents a slow sweep from starting a second overlapping sweep if an interval
 * tick fires while the previous one is still in flight. Errors are caught so a failure (e.g. a transient
 * DB blip) never crashes the process — it's logged and the next tick tries again.
 */
export function startTallyConnectorOfflineMonitor({
  tallyConnectorService, intervalMs, thresholdMs,
}) {
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await tallyConnectorService.sweepOfflineConnectors({ thresholdMs });
      if (result.transitioned > 0) {
        logger.info({ event: 'tally.connector.offline_sweep', ...result }, 'Tally connector offline sweep transitioned connectors');
      }
    } catch (err) {
      logger.error({ event: 'tally.connector.offline_sweep_failed', err: err.message }, 'Tally connector offline sweep failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.(); // never keeps the process alive on its own (tests, graceful shutdown)
  return { stop: () => clearInterval(timer), runOnce: tick };
}
