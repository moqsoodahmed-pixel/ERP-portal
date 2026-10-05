import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

/**
 * Phase 16.1 — offline monitor (TallyConnectorService#sweepOfflineConnectors), exercised directly against
 * the service/repo rather than through HTTP, since it's a scheduled sweep, not a request handler.
 */
test('Phase 16.1: Tally connector offline monitor (stale detection, idempotency, recovery, tenant isolation)', async () => {
  const h = await createHarness();
  const { services, repos, A, B } = h;

  const ctxFor = (tenant, admin) => ({ tenantId: String(tenant._id), actor: { id: String(admin._id), role: 'CLIENT_ADMIN' } });

  await services.tallyConfigService.upsertConfig(ctxFor(A.tenant, A.admin), {
    enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://127.0.0.1:9', companyName: 'A Tally Co',
    defaultVoucherType: 'Sales', salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST',
  });
  await services.tallyConfigService.upsertConfig(ctxFor(B.tenant, B.admin), {
    enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://127.0.0.1:9', companyName: 'B Tally Co',
    defaultVoucherType: 'Sales', salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST',
  });

  const freshA = await services.tallyConnectorService.register(ctxFor(A.tenant, A.admin), { name: 'A Fresh' });
  const staleA = await services.tallyConnectorService.register(ctxFor(A.tenant, A.admin), { name: 'A Stale' });
  const staleB = await services.tallyConnectorService.register(ctxFor(B.tenant, B.admin), { name: 'B Stale' });
  const neverA = await services.tallyConnectorService.register(ctxFor(A.tenant, A.admin), { name: 'A Never Connected' });

  // Give `freshA` a recent heartbeat and the two "stale" ones an old one; `neverA` keeps lastHeartbeatAt null.
  await repos.tallyConnectors.recordHeartbeat(freshA.id, { lastHeartbeatAt: new Date() });
  const longAgo = new Date(Date.now() - 10 * 60 * 1000);
  await repos.tallyConnectors.recordHeartbeat(staleA.id, { lastHeartbeatAt: longAgo });
  await repos.tallyConnectors.recordHeartbeat(staleB.id, { lastHeartbeatAt: longAgo });

  const thresholdMs = 2 * 60 * 1000;
  const first = await services.tallyConnectorService.sweepOfflineConnectors({ thresholdMs });
  // 3 stale candidates: staleA, staleB, neverA (never-connected counts as offline per isOffline()).
  assert.equal(first.transitioned, 3);

  const freshAfter = await services.tallyConnectorService.get(ctxFor(A.tenant, A.admin), freshA.id);
  assert.equal(freshAfter.status, 'ACTIVE', 'a connector with a recent heartbeat must stay ACTIVE/online');

  const staleAAfter = await services.tallyConnectorService.get(ctxFor(A.tenant, A.admin), staleA.id);
  assert.equal(staleAAfter.status, 'INACTIVE');
  const staleBAfter = await services.tallyConnectorService.get(ctxFor(B.tenant, B.admin), staleB.id);
  assert.equal(staleBAfter.status, 'INACTIVE');
  const neverAAfter = await services.tallyConnectorService.get(ctxFor(A.tenant, A.admin), neverA.id);
  assert.equal(neverAAfter.status, 'INACTIVE');

  // Idempotency: re-running the sweep must not re-transition (and therefore not re-audit) already-OFFLINE connectors.
  const second = await services.tallyConnectorService.sweepOfflineConnectors({ thresholdMs });
  assert.equal(second.transitioned, 0, 'already-offline connectors must not be re-transitioned');

  const auditEntries = await repos.audit.findPage({ tenantId: String(A.tenant._id), action: 'TALLY_CONNECTOR_OFFLINE', limit: 50 });
  const staleAAudits = (auditEntries.items ?? auditEntries).filter((e) => String(e.resourceId) === String(staleA.id));
  assert.equal(staleAAudits.length, 1, 'exactly one OFFLINE audit entry per connector, even across repeated sweeps');

  // Recovery: a heartbeat for an offline-monitored connector brings it back to ACTIVE and audits once.
  await services.tallyConnectorService.heartbeat(ctxFor(A.tenant, A.admin), staleA.id, { version: '1.2.3' });
  const recovered = await services.tallyConnectorService.get(ctxFor(A.tenant, A.admin), staleA.id);
  assert.equal(recovered.status, 'ACTIVE');

  const recoveredAudits = await repos.audit.findPage({ tenantId: String(A.tenant._id), action: 'TALLY_CONNECTOR_RECOVERED', limit: 50 });
  const staleARecoveredAudits = (recoveredAudits.items ?? recoveredAudits).filter((e) => String(e.resourceId) === String(staleA.id));
  assert.equal(staleARecoveredAudits.length, 1);

  // Cross-tenant isolation in the scheduler's own query: tenant B's stale connector was transitioned by the
  // SAME sweep call (it's a platform-wide sweep), but its audit entry is scoped to tenant B, never tenant A.
  const bAudits = await repos.audit.findPage({ tenantId: String(B.tenant._id), action: 'TALLY_CONNECTOR_OFFLINE', limit: 50 });
  const staleBAudits = (bAudits.items ?? bAudits).filter((e) => String(e.resourceId) === String(staleB.id));
  assert.equal(staleBAudits.length, 1);
  const crossTenantLeak = (auditEntries.items ?? auditEntries).filter((e) => String(e.resourceId) === String(staleB.id));
  assert.equal(crossTenantLeak.length, 0, 'tenant A audit query must never surface tenant B connector events');

  // A manually REVOKED connector is never touched by the monitor (not ACTIVE, so excluded from the query).
  const revoked = await services.tallyConnectorService.register(ctxFor(A.tenant, A.admin), { name: 'A Revoked' });
  await repos.tallyConnectors.recordHeartbeat(revoked.id, { lastHeartbeatAt: longAgo });
  await services.tallyConnectorService.revoke(ctxFor(A.tenant, A.admin), revoked.id);
  const third = await services.tallyConnectorService.sweepOfflineConnectors({ thresholdMs });
  assert.equal(third.transitioned, 0);
  const revokedAfter = await services.tallyConnectorService.get(ctxFor(A.tenant, A.admin), revoked.id);
  assert.equal(revokedAfter.status, 'REVOKED', 'revoked connectors are left exactly as revoked, not touched by the monitor');
});

test('Phase 16.1: offline monitor sweep failure never throws past the scheduler wrapper', async () => {
  const { startTallyConnectorOfflineMonitor } = await import('../../src/jobs/tallyConnectorOfflineMonitor.js');
  const failingService = { sweepOfflineConnectors: async () => { throw new Error('boom'); } };
  const monitor = startTallyConnectorOfflineMonitor({ tallyConnectorService: failingService, intervalMs: 60_000, thresholdMs: 120_000 });
  await assert.doesNotReject(monitor.runOnce());
  monitor.stop();
});
