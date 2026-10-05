import { AUDIT_ACTIONS, TALLY_SYNC_STATUS } from '../../constants/statuses.js';
import { ConflictError, IntegrationError, ValidationError } from '../../utils/errors.js';
import { TALLY_ERROR_CODES } from './tally.constants.js';
import { TallyMapper } from './tally.mapper.js';
import { assertSafeTallyUrl } from './tally.ssrf.js';

/** Fields that resolveConfig() decrypts/attaches but which must NEVER be serialized back in an API response. */
const SECRET_FIELDS = ['authPasswordEncrypted', 'credentialsEncrypted', 'authPasswordPlain'];

function maskConfig(doc) {
  if (!doc) return doc;
  const out = { ...doc };
  const hasPassword = Boolean(doc.authPasswordEncrypted);
  for (const f of SECRET_FIELDS) delete out[f];
  out.hasPassword = hasPassword;
  return out;
}

/**
 * Tenant-scoped Tally configuration: create/update, masked read, and connection testing.
 * Orchestrates the adapter but owns no XML/HTTP details itself.
 */
export class TallyConfigService {
  constructor({ integrationRepo, adapter, encryption, auditService }) {
    Object.assign(this, { integrationRepo, adapter, encryption, auditService });
  }

  async getConfig(ctx) {
    const doc = await this.integrationRepo.findByTenant(ctx.tenantId);
    return maskConfig(doc) ?? { enabled: false, status: 'NOT_CONFIGURED', hasPassword: false, lastConnectionStatus: 'NEVER_TESTED' };
  }

  /** Resolves config WITH the decrypted password attached as `authPasswordPlain` for internal adapter use only. Never return this object from a controller. */
  async _resolveConfigForTransport(ctx) {
    const doc = await this.integrationRepo.findByTenantWithSecret(ctx.tenantId);
    if (!doc) throw new ConflictError('Tally is not configured for this tenant', TALLY_ERROR_CODES.NOT_CONFIGURED);
    if (!doc.enabled) throw new ConflictError('Tally integration is disabled for this tenant', TALLY_ERROR_CODES.DISABLED);
    const authPasswordPlain = doc.authPasswordEncrypted && this.encryption ? this.encryption.decrypt(doc.authPasswordEncrypted) : undefined;
    return { ...doc, authPasswordPlain };
  }

  async upsertConfig(ctx, dto) {
    const { authPassword, retryMaxAttempts, ...rest } = dto;
    TallyMapper.assertLedgerNames({
      salesLedger: rest.salesLedger, cgstLedger: rest.cgstLedger, sgstLedger: rest.sgstLedger, igstLedger: rest.igstLedger, roundOffLedger: rest.roundOffLedger, discountLedger: rest.discountLedger,
    });
    const patch = { ...rest };
    if (retryMaxAttempts !== undefined) patch.retryPolicy = { maxAttempts: retryMaxAttempts };
    // Reject link-local/metadata addresses and disallowed protocols at configuration time, not only when
    // a sync/test-connection call is eventually made — an admin should never be able to save a URL that
    // can never pass the SSRF gate.
    if (patch.baseUrl) {
      await assertSafeTallyUrl(patch.baseUrl);
      patch.status = patch.enabled === false ? 'DISABLED' : 'CONFIGURED';
    }
    if (authPassword) {
      if (!this.encryption) throw new ValidationError('Server encryption is not configured; cannot store a Tally credential');
      patch.authPasswordEncrypted = this.encryption.encrypt(authPassword);
    }
    const existing = await this.integrationRepo.findByTenant(ctx.tenantId);
    const saved = await this.integrationRepo.upsert(ctx.tenantId, patch, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: existing ? AUDIT_ACTIONS.TALLY_INTEGRATION_UPDATED : AUDIT_ACTIONS.TALLY_INTEGRATION_CREATED,
      resourceType: 'TallyIntegration', resourceId: saved._id,
      metadata: { enabled: saved.enabled, connectionType: saved.connectionType, baseUrlHost: safeHost(saved.baseUrl) },
    });
    return maskConfig(saved);
  }

  async testConnection(ctx) {
    let integration;
    try {
      integration = await this._resolveConfigForTransport(ctx);
    } catch (err) {
      await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_CONNECTION_TESTED, resourceType: 'TallyIntegration', metadata: { connected: false, errorCode: err.code } });
      return { connected: false, errorCode: err.code ?? TALLY_ERROR_CODES.NOT_CONFIGURED, message: err.message };
    }
    const result = await this.adapter.testConnection(integration);
    await this.integrationRepo.upsert(ctx.tenantId, {
      lastConnectedAt: new Date(), lastConnectionStatus: result.connected ? 'SUCCESS' : 'FAILED',
    }, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_CONNECTION_TESTED, resourceType: 'TallyIntegration', resourceId: integration._id,
      metadata: { connected: result.connected, errorCode: result.errorCode, baseUrlHost: safeHost(integration.baseUrl) },
    });
    return result;
  }
}

function safeHost(baseUrl) {
  try { return new URL(baseUrl).hostname; } catch { return undefined; }
}

/**
 * Invoice -> Tally sync orchestration. Depends on invoiceService ONLY through its public
 * `getIssuedInvoiceForTally()` method (never queries the Invoice collection directly), and on the
 * TallyAdapter for everything XML/HTTP. This is the "TallyService (use-cases)" box in the architecture
 * diagram in docs/tally-integration.md.
 */
export class TallySyncService {
  constructor({ syncRepo, integrationRepo, adapter, invoiceService, auditService, encryption, notificationService = null }) {
    Object.assign(this, { syncRepo, integrationRepo, adapter, invoiceService, auditService, encryption, notificationService });
  }

  async getStatus(ctx, invoiceId) {
    await this.invoiceService.get(ctx, invoiceId); // 404s for cross-tenant / missing invoices before leaking sync state
    const record = await this.syncRepo.findByInvoice(ctx.tenantId, invoiceId);
    if (!record) return { status: TALLY_SYNC_STATUS.NOT_SYNCED, invoiceId };
    return toStatusView(record);
  }

  /**
   * Idempotent sync entrypoint. Per the API contract:
   *  - an existing SYNCED record returns immediately, no new Tally call;
   *  - SYNCING is rejected with 409 (another request is already in flight);
   *  - FAILED is retried, up to the configured max attempts;
   *  - otherwise a new record is created and attempted.
   */
  async sync(ctx, invoiceId) {
    // Tenant-scoped existence check first (404s cross-tenant/missing invoices before anything else).
    await this.invoiceService.get(ctx, invoiceId);

    // A previously-SYNCED invoice stays idempotently SYNCED even if it has since been CANCELLED: we never
    // auto-reverse a Tally voucher on cancellation (documented future enhancement — see docs/tally-integration.md).
    const existing = await this.syncRepo.findByInvoice(ctx.tenantId, invoiceId);
    if (existing?.status === TALLY_SYNC_STATUS.SYNCED) return toStatusView(existing); // idempotent no-op, no Tally call
    if (existing?.status === TALLY_SYNC_STATUS.SYNCING) throw new ConflictError('A Tally sync for this invoice is already in progress', TALLY_ERROR_CODES.SYNC_IN_PROGRESS);

    // Any NEW sync attempt (first attempt or retry) requires the invoice to be currently ISSUED:
    // DRAFT is never eligible; CANCELLED-and-never-synced stays ineligible.
    const invoice = await this.invoiceService.getIssuedInvoiceForTally(ctx, invoiceId);
    const integration = await this.integrationRepo.findByTenantWithSecret(ctx.tenantId);
    if (!integration) throw new ConflictError('Tally is not configured for this tenant', TALLY_ERROR_CODES.NOT_CONFIGURED);
    if (!integration.enabled) throw new ConflictError('Tally integration is disabled for this tenant', TALLY_ERROR_CODES.DISABLED);

    const maxAttempts = integration.retryPolicy?.maxAttempts ?? 3;
    let claim;
    if (!existing) {
      claim = await this.syncRepo.createClaim(ctx.tenantId, invoiceId, integration._id, ctx.actor.id);
      if (!claim) {
        // Lost the race: someone else just created the record. Re-read and let its state decide.
        return this.sync(ctx, invoiceId);
      }
    } else if (existing.status === TALLY_SYNC_STATUS.SYNCING) {
      throw new ConflictError('A Tally sync for this invoice is already in progress', TALLY_ERROR_CODES.SYNC_IN_PROGRESS);
    } else {
      // FAILED or RETRYING: claim it for a retry via the conditional-update guard (same pattern as invoice issue/cancel).
      if (existing.attempt >= maxAttempts) throw new ConflictError('Maximum Tally sync retry attempts exceeded', TALLY_ERROR_CODES.RETRY_LIMIT_EXCEEDED);
      claim = await this.syncRepo.conditionalUpdate(ctx.tenantId, invoiceId, { status: { $in: [TALLY_SYNC_STATUS.FAILED, TALLY_SYNC_STATUS.RETRYING] } }, {
        status: TALLY_SYNC_STATUS.SYNCING, attempt: existing.attempt + 1, startedAt: new Date(),
      });
      if (!claim) throw new ConflictError('A Tally sync for this invoice is already in progress', TALLY_ERROR_CODES.SYNC_IN_PROGRESS);
    }

    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.TALLY_SYNC_STARTED, resourceType: 'Invoice', resourceId: invoiceId, metadata: { attempt: claim.attempt } });

    const decrypted = integration.authPasswordEncrypted && this.encryption ? this.encryption.decrypt(integration.authPasswordEncrypted) : undefined;
    let result;
    try {
      result = await this.adapter.syncInvoice({ ...integration, authPasswordPlain: decrypted }, invoice);
    } catch (err) {
      result = { success: false, errorCode: err.code ?? TALLY_ERROR_CODES.UNREACHABLE, message: err instanceof IntegrationError ? err.message : 'Tally sync failed' };
    }

    if (result.success) {
      const saved = await this.syncRepo.conditionalUpdate(ctx.tenantId, invoiceId, { status: TALLY_SYNC_STATUS.SYNCING }, {
        status: TALLY_SYNC_STATUS.SYNCED, voucherId: result.voucherId, voucherNumber: result.voucherNumber, completedAt: new Date(), errorCode: undefined, errorMessage: undefined,
      });
      await this.auditService.record(ctx, {
        action: AUDIT_ACTIONS.TALLY_SYNC_SUCCEEDED, resourceType: 'Invoice', resourceId: invoiceId, metadata: { voucherNumber: result.voucherNumber },
      });
      const view = saved ?? { ...claim, status: TALLY_SYNC_STATUS.SYNCED, voucherId: result.voucherId, voucherNumber: result.voucherNumber };
      await this.notificationService?.tallySyncSucceeded(ctx.tenantId, invoice, view);
      return toStatusView(view);
    }

    const nextStatus = claim.attempt >= maxAttempts ? TALLY_SYNC_STATUS.FAILED : TALLY_SYNC_STATUS.RETRYING;
    const saved = await this.syncRepo.conditionalUpdate(ctx.tenantId, invoiceId, { status: TALLY_SYNC_STATUS.SYNCING }, {
      status: nextStatus, errorCode: result.errorCode, errorMessage: String(result.message ?? '').slice(0, 1000), completedAt: new Date(),
    });
    await this.auditService.record(ctx, {
      action: claim.attempt > 1 ? AUDIT_ACTIONS.TALLY_SYNC_RETRIED : AUDIT_ACTIONS.TALLY_SYNC_FAILED,
      resourceType: 'Invoice', resourceId: invoiceId, metadata: { errorCode: result.errorCode, attempt: claim.attempt },
    });
    const failedView = saved ?? { ...claim, status: nextStatus, errorCode: result.errorCode, errorMessage: result.message };
    // Phase 9: one TALLY_SYNC_FAILED per failed attempt (dedup key includes the attempt number).
    await this.notificationService?.tallySyncFailed(ctx.tenantId, invoice, failedView);
    // Reported via 200 with status FAILED/RETRYING, not an HTTP error — the client polls/retries via this same endpoint.
    return toStatusView(failedView);
  }
}

function toStatusView(record) {
  return {
    invoiceId: record.invoiceId, status: record.status, attempt: record.attempt,
    voucherId: record.voucherId, voucherNumber: record.voucherNumber,
    errorCode: record.errorCode, errorMessage: record.errorMessage,
    startedAt: record.startedAt, completedAt: record.completedAt,
  };
}
