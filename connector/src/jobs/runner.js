/**
 * Phase 16 — connector job loop (Side B). Owns NO ERP business logic: it polls, claims, hands the claimed
 * payload to LocalTallyAdapter, and reports back exactly what the adapter returned. Every bill-status /
 * job-state decision remains server-side (Side A) — this loop never decides retry policy, never decides
 * whether a bill "is ready", and never talks to Mongo/the ERP database directly.
 */
export class JobRunner {
  constructor({
    erpClient, tallyAdapter, logger, pollIntervalMs = 10_000, heartbeatIntervalMs = 30_000, connectorVersion = '0.1.0',
  }) {
    Object.assign(this, {
      erpClient, tallyAdapter, logger, pollIntervalMs, heartbeatIntervalMs, connectorVersion,
    });
    this._timers = [];
    this._stopped = true;
  }

  async pollOnce() {
    const jobs = await this.erpClient.listJobs();
    for (const job of jobs) {
      // eslint-disable-next-line no-await-in-loop
      await this.processOne(job.id).catch((err) => this.logger.error('job processing failed', { jobId: job.id, error: err.message }));
    }
    return jobs.length;
  }

  async processOne(jobId) {
    let claimed;
    try {
      claimed = await this.erpClient.claimJob(jobId);
    } catch (err) {
      if (err.status === 409) { this.logger.info('job already claimed by another connector or no longer available', { jobId }); return; }
      throw err;
    }
    this.logger.info('claimed job', { jobId, type: claimed.type });
    const result = await this.tallyAdapter.submit(claimed.payload);
    if (result.success) {
      await this.erpClient.reportResult(jobId, { status: 'SUCCEEDED', tallyReference: result.voucherNumber ?? result.voucherId, requestId: jobId });
      this.logger.info('job succeeded', { jobId, tallyReference: result.voucherNumber ?? result.voucherId });
    } else {
      await this.erpClient.reportResult(jobId, { status: 'FAILED', errorCode: result.errorCode, message: result.message, requestId: jobId });
      this.logger.warn('job failed', { jobId, errorCode: result.errorCode });
    }
  }

  async heartbeatOnce(extra = {}) {
    try {
      await this.erpClient.heartbeat({ version: this.connectorVersion, tallyAvailable: this.tallyAdapter.mode === 'mock' ? true : undefined, ...extra });
    } catch (err) {
      this.logger.warn('heartbeat failed', { error: err.message });
    }
  }

  start() {
    this._stopped = false;
    const pollLoop = async () => {
      if (this._stopped) return;
      try { await this.pollOnce(); } catch (err) { this.logger.error('poll failed', { error: err.message }); }
      this._timers.push(setTimeout(pollLoop, this.pollIntervalMs));
    };
    const heartbeatLoop = async () => {
      if (this._stopped) return;
      await this.heartbeatOnce();
      this._timers.push(setTimeout(heartbeatLoop, this.heartbeatIntervalMs));
    };
    pollLoop();
    heartbeatLoop();
  }

  stop() {
    this._stopped = true;
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }
}
