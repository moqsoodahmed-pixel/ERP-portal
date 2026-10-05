import { AUDIT_ACTIONS, TALLY_CONNECTOR_STATUS } from '../../constants/statuses.js';
import { AuthenticationError, NotFoundError, ValidationError } from '../../utils/errors.js';
import { generateConnectorSecret, hashApiKey, isWellFormedConnectorSecret } from '../../security/apiKey.js';
import { TALLY_CONNECTOR_SCOPES } from './tally.constants.js';

/** Fields a list/detail view may return. The raw secret and its hash never appear here (spec Step 5/25). */
const toView = (doc) => ({
  id: doc._id,
  name: doc.name,
  secretPrefix: doc.secretPrefix,
  status: doc.status,
  scopes: doc.scopes ?? [],
  version: doc.version ?? null,
  lastHeartbeatAt: doc.lastHeartbeatAt ?? null,
  lastPollAt: doc.lastPollAt ?? null,
  lastSuccessfulSyncAt: doc.lastSuccessfulSyncAt ?? null,
  lastErrorCode: doc.lastErrorCode ?? null,
  lastErrorMessage: doc.lastErrorMessage ?? null,
  lastTallyAvailable: doc.lastTallyAvailable ?? null,
  tallyCompanyName: doc.tallyCompanyName ?? null,
  tallyCompanyGuid: doc.tallyCompanyGuid ?? null,
  revokedAt: doc.revokedAt ?? null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const HEARTBEAT_THROTTLE_MS = 15_000; // spec Step 20: throttle heartbeat persistence to avoid a DB write storm

/**
 * Phase 16 — Tally Connector credential lifecycle (register/list/revoke/rotate) + the authentication/
 * heartbeat logic used by middlewares/tallyConnectorAuth.js and the connector controller. This is a THIRD,
 * independent credential system alongside the ERP user JWT (middlewares/access.js) and the Tally Public
 * API key (tallyApiKey.service.js) — a connector never reuses either (spec Step 5/7).
 */
export class TallyConnectorService {
  constructor({
    tallyConnectorRepo, tallyIntegrationRepo, auditService, securityService, notificationService = null,
  }) {
    Object.assign(this, {
      tallyConnectorRepo, tallyIntegrationRepo, auditService, securityService, notificationService,
    });
  }

  async list(ctx) {
    const docs = await this.tallyConnectorRepo.listByTenant(ctx.tenantId);
    return docs.map(toView);
  }

  async get(ctx, id) {
    const doc = await this.tallyConnectorRepo.findOneById(ctx.tenantId, id);
    if (!doc) throw new NotFoundError('Connector not found');
    return toView(doc);
  }

  /**
   * Registration (spec Step 25 "Register Connector"). The connector's Tally company identity is taken
   * from the tenant's EXISTING TallyIntegration record where available (never fabricated — spec Step 15) —
   * an admin registering a connector before configuring Tally integration simply gets a connector with no
   * company binding yet, which processing later refuses to use (see tallyJob.service.js#assertCompanyBinding).
   */
  async register(ctx, { name }) {
    const integration = await this.tallyIntegrationRepo.findByTenant(ctx.tenantId);
    const { key, secretPrefix } = generateConnectorSecret();
    const doc = await this.tallyConnectorRepo.create(ctx.tenantId, {
      name,
      secretPrefix,
      secretHash: hashApiKey(key),
      status: TALLY_CONNECTOR_STATUS.ACTIVE,
      scopes: [...TALLY_CONNECTOR_SCOPES],
      tallyCompanyName: integration?.companyName ?? null,
      tallyCompanyGuid: integration?.companyGuid ?? null,
    }, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_CONNECTOR_CREATED, resourceType: 'TallyConnector', resourceId: doc._id, metadata: { name: doc.name },
    });
    return { ...toView(doc), connectorSecret: key };
  }

  async revoke(ctx, id) {
    const existing = await this.tallyConnectorRepo.findOneById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError('Connector not found');
    const updated = await this.tallyConnectorRepo.conditionalUpdate(ctx.tenantId, id, {}, {
      status: TALLY_CONNECTOR_STATUS.REVOKED, revokedAt: new Date(), revokedBy: ctx.actor.id,
    });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_REVOKED, resourceType: 'TallyConnector', resourceId: id, metadata: { name: existing.name } });
    return toView(updated ?? existing);
  }

  /** Rotation = same record identity (id/name/scopes preserved), new secret; old secret stops working immediately. */
  async rotate(ctx, id) {
    const existing = await this.tallyConnectorRepo.findOneById(ctx.tenantId, id);
    if (!existing) throw new NotFoundError('Connector not found');
    const { key, secretPrefix } = generateConnectorSecret();
    const updated = await this.tallyConnectorRepo.conditionalUpdate(ctx.tenantId, id, {}, {
      secretPrefix, secretHash: hashApiKey(key), status: TALLY_CONNECTOR_STATUS.ACTIVE, revokedAt: null, revokedBy: null,
    });
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_ROTATED, resourceType: 'TallyConnector', resourceId: id, metadata: { name: existing.name } });
    return { ...toView(updated), connectorSecret: key };
  }

  /**
   * Authenticates an inbound connector request (spec Step 5/8). Tenant identity is resolved FROM the
   * matched record — a request body/query/URL tenantId is never consulted here or anywhere downstream.
   */
  async authenticate(rawSecret, ctx) {
    const fail = async (reason) => {
      await this.securityService.record('TALLY_CONNECTOR_AUTH_FAILED', ctx, { severity: 'LOW', details: { reason } });
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_AUTH_FAILED, resourceType: 'TallyConnector', metadata: { reason } });
      throw new AuthenticationError('Invalid or missing connector credential', 'TALLY_CONNECTOR_INVALID');
    };
    if (!isWellFormedConnectorSecret(rawSecret)) return fail('MALFORMED');
    const doc = await this.tallyConnectorRepo.findByHash(hashApiKey(rawSecret));
    if (!doc) return fail('NOT_FOUND');
    if (doc.status !== TALLY_CONNECTOR_STATUS.ACTIVE) return fail(doc.status === TALLY_CONNECTOR_STATUS.REVOKED ? 'REVOKED' : 'INACTIVE');
    return {
      tenantId: String(doc.tenantId), connectorId: String(doc._id), scopes: new Set(doc.scopes ?? []), name: doc.name,
    };
  }

  /** spec Step 20 — heartbeat. Throttled: a connector polling every few seconds doesn't become a DB write every time. */
  async heartbeat(ctx, connectorId, { version, tallyAvailable } = {}) {
    const existing = await this.tallyConnectorRepo.findOneById(ctx.tenantId, connectorId);
    if (!existing) throw new NotFoundError('Connector not found');
    const now = new Date();
    const stale = !existing.lastHeartbeatAt || (now.getTime() - new Date(existing.lastHeartbeatAt).getTime()) > HEARTBEAT_THROTTLE_MS;
    if (stale) {
      await this.tallyConnectorRepo.recordHeartbeat(connectorId, {
        lastHeartbeatAt: now,
        version: version ?? existing.version,
        lastTallyAvailable: tallyAvailable ?? null,
      });
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_HEARTBEAT, resourceType: 'TallyConnector', resourceId: connectorId, metadata: { tallyAvailable } });
    }
    // Phase 16.1: a heartbeat arriving for a connector the offline monitor flipped to INACTIVE means it's
    // back — recover it to ACTIVE and audit once. A manually-deactivated connector (offlineSince null) is
    // left alone; only the monitor's own transition is auto-reversed.
    if (existing.status === TALLY_CONNECTOR_STATUS.INACTIVE && existing.offlineSince) {
      const recovered = await this.tallyConnectorRepo.markOnlineIfOfflineMonitored(connectorId);
      if (recovered) {
        await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_RECOVERED, resourceType: 'TallyConnector', resourceId: connectorId, metadata: { name: existing.name } });
        if (this.notificationService?.notifyTenantAdmins) {
          await this.notificationService.notifyTenantAdmins(ctx.tenantId, { type: 'CONNECTOR_RECOVERED', connectorId, connectorName: existing.name });
        }
      }
    }
    return { ok: true, throttled: !stale };
  }

  /**
   * Phase 16.1 scheduled offline monitor (spec Step 4). Platform-wide sweep — intentionally not tenant
   * scoped to a single ctx, since it runs on a timer, not behind a request. Reuses `isOffline` so the
   * staleness rule lives in exactly one place. Idempotent: `markOfflineIfActive` only flips rows still
   * ACTIVE, so a connector already INACTIVE is skipped with no repeated write/audit/notification.
   */
  async sweepOfflineConnectors({ thresholdMs = 2 * 60 * 1000 } = {}) {
    const cutoff = new Date(Date.now() - thresholdMs);
    const candidates = await this.tallyConnectorRepo.findStaleActive(cutoff);
    let transitioned = 0;
    for (const doc of candidates) {
      if (!(await this.isOffline(doc, { thresholdMs }))) continue; // defensive re-check
      const updated = await this.tallyConnectorRepo.markOfflineIfActive(doc._id);
      if (!updated) continue; // lost the race to a concurrent heartbeat/update — skip silently
      transitioned += 1;
      const ctx = { tenantId: String(doc.tenantId), actor: { id: null, type: 'SYSTEM' } };
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTOR_OFFLINE, resourceType: 'TallyConnector', resourceId: doc._id, metadata: { name: doc.name } });
      if (this.notificationService?.notifyTenantAdmins) {
        await this.notificationService.notifyTenantAdmins(doc.tenantId, { type: 'CONNECTOR_OFFLINE', connectorId: String(doc._id), connectorName: doc.name });
      }
    }
    return { scanned: candidates.length, transitioned };
  }

  async recordPoll(connectorId) {
    return this.tallyConnectorRepo.recordHeartbeat(connectorId, { lastPollAt: new Date() });
  }

  /** Used by offline-detection reporting (spec Step 21) — no state mutation, read-only projection. */
  async isOffline(doc, { thresholdMs = 2 * 60 * 1000 } = {}) {
    if (!doc.lastHeartbeatAt) return true;
    return (Date.now() - new Date(doc.lastHeartbeatAt).getTime()) > thresholdMs;
  }

  _validateScopeSet(scopes) {
    const list = Array.isArray(scopes) ? [...new Set(scopes)] : [];
    const invalid = list.filter((s) => !TALLY_CONNECTOR_SCOPES.includes(s));
    if (invalid.length) throw new ValidationError(`Unknown scope(s): ${invalid.join(', ')}`);
    return list;
  }
}
