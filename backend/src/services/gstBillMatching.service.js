import { ConflictError, NotFoundError } from '../utils/errors.js';
import {
  AUDIT_ACTIONS, GST_BILL_MATCH_STATUS as S, GST_BILL_OVERALL_MATCH_STATUS as OVERALL,
} from '../constants/statuses.js';
import { toMoney } from '../utils/money.js';
import { TALLY_ERROR_CODES } from '../integrations/tally/tally.constants.js';
import { periodBounds } from './gstFiling.service.js';

const normalize = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Phase 20 — GST Bill <-> Tally bill-by-bill matching.
 *
 * MATCHING UNIT: each entry in GSTBill.items[] (serialNo/productName/rate) is treated as "one client bill"
 * — the Phase 19 GSTBill model has no separate per-bill sub-collection, invoice number, date or party field
 * (by design: the Bill Builder is intentionally just S.No/Product Name/Rate — see GSTBill model doc
 * comment). Per the product spec's own Step 17/18 guidance ("do not invent client bill fields... design the
 * matching strategy around the data that actually exists"), this service does NOT invent an invoice number
 * or date on the client side; it matches using the two fields that genuinely exist and vary per line:
 * `productName` (checked against the Tally voucher's NARRATION, which legitimately carries a bill/item
 * description in Tally) as the identity anchor, and `rate` (checked against the voucher AMOUNT, compared
 * with decimal-safe money.js, never floating point) as the integrity/value check. This is intentionally
 * MORE conservative than amount-only matching (explicitly prohibited by the spec, Step 7): a rate that
 * happens to coincide with an unrelated voucher is never silently claimed as a match.
 *
 * TALLY DATA SOURCE: this codebase's existing Tally integration is push-only in every path (TallyAdapter.
 * syncInvoice posts one voucher; the Windows TallyConnector/TallyJob bridge only reports SUCCEEDED/FAILED
 * for a push, never a fetched list) — there was no existing capability to read voucher data back out of
 * Tally for comparison. `TallyAdapter.fetchVouchers` (added in this phase) is a minimal, same-pattern
 * extension of the existing adapter (same TallyIntegration config, same SSRF/timeout/encryption, same
 * normalized success/failure contract) — not a second Tally system.
 */
export class GSTBillMatchingService {
  constructor({
    gstBillRepo, gstBillMatchRepo, tallyIntegrationRepo, tallyAdapter, encryption, auditService,
  }) {
    Object.assign(this, {
      gstBillRepo, gstBillMatchRepo, tallyIntegrationRepo, tallyAdapter, encryption, auditService,
    });
  }

  async get(ctx, filing) {
    const existing = await this.gstBillMatchRepo.findByFiling(ctx.tenantId, filing._id);
    if (!existing) throw new NotFoundError('Tally matching has not been run for this filing yet');
    return existing;
  }

  /** Re-running replaces the same (tenantId, filingId) row in place (idempotent — spec Step 40); the
   * client bill itself is never modified (spec Step 41) — only this comparison result is written. */
  async run(ctx, filing) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill || !bill.items?.length) throw new ConflictError('This filing has no saved bill items to match yet', 'GST_BILL_EMPTY');

    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_MATCH_STARTED, resourceType: 'GSTFiling', resourceId: filing._id, tenantId: ctx.tenantId, metadata: { itemCount: bill.items.length },
    });

    const integration = await this.tallyIntegrationRepo.findByTenantWithSecret(ctx.tenantId);
    if (!integration || !integration.enabled || integration.status !== 'CONFIGURED') {
      return this.#persistError(ctx, filing, bill, 'Tally integration is not configured for this client.', TALLY_ERROR_CODES.NOT_CONFIGURED);
    }
    // Tally company isolation (spec Step 38): never guess a default company — a configured integration
    // without a company name is a controlled configuration error, not a silent cross-company comparison.
    if (!integration.companyName) {
      return this.#persistError(ctx, filing, bill, 'Tally company mapping is missing for this client.', TALLY_ERROR_CODES.MAPPING_MISSING);
    }

    const { from, to } = periodBounds(filing.periodKey);
    const decrypted = integration.authPasswordEncrypted && this.encryption ? this.encryption.decrypt(integration.authPasswordEncrypted) : undefined;
    const fetchResult = await this.tallyAdapter.fetchVouchers({ ...integration, authPasswordPlain: decrypted }, { fromDate: from, toDate: to });

    if (!fetchResult.success) {
      return this.#persistError(ctx, filing, bill, 'Unable to retrieve Tally data. Please check the Tally connection and try again.', fetchResult.errorCode);
    }

    const saved = await this.#matchAndPersist(ctx, filing, bill, fetchResult.vouchers);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_MATCH_COMPLETED, resourceType: 'GSTFiling', resourceId: filing._id, tenantId: ctx.tenantId,
      metadata: { overallStatus: saved.overallStatus, matchedCount: saved.matchedCount, totalClientBills: saved.totalClientBills },
    });
    return saved;
  }

  /**
   * Deterministic, order-independent-of-evidence matching: every client bill (ALL of them — spec Step 45,
   * never stop early) is checked against the full fetched voucher set. A voucher is "claimed" only on a
   * confirmed MATCHED outcome, so the same Tally record can never satisfy two different client bills, and
   * any voucher nobody claims is reported as an extra (spec Step 12) rather than silently dropped.
   */
  async #matchAndPersist(ctx, filing, bill, rawVouchers) {
    const vouchers = rawVouchers.map((v) => ({ ...v, claimed: false }));
    const results = [];
    let matchedCount = 0;

    const items = [...bill.items].sort((a, b) => a.serialNo - b.serialNo);
    for (const item of items) {
      const itemName = normalize(item.productName);
      const candidates = vouchers.filter((v) => !v.claimed && normalize(v.narration) === itemName);

      if (candidates.length === 0) {
        results.push(this.#result(item, null, S.NOT_FOUND, 'No corresponding Tally bill found.'));
        continue;
      }
      if (candidates.length > 1) {
        results.push(this.#result(item, null, S.DUPLICATE, 'Multiple Tally records match this bill.'));
        continue;
      }
      const candidate = candidates[0];
      const amountsEqual = toMoney(item.rate).equals(toMoney(candidate.amount ?? 0));
      if (amountsEqual) {
        candidate.claimed = true;
        matchedCount += 1;
        results.push(this.#result(item, candidate, S.MATCHED, 'Bill matched successfully.'));
      } else {
        results.push(this.#result(item, candidate, S.MISMATCH, 'Bill total does not match Tally total.'));
      }
    }

    const totalClientBills = items.length;
    const totalTallyBills = vouchers.length;
    const unmatchedCount = totalClientBills - matchedCount;
    const extraTallyCount = totalTallyBills - matchedCount;
    // FULLY_MATCHED requires every client bill matched AND no unexplained extra Tally records (spec Step 12/24).
    const overallStatus = matchedCount === totalClientBills && extraTallyCount === 0
      ? OVERALL.FULLY_MATCHED
      : (matchedCount === 0 ? OVERALL.NOT_MATCHED : OVERALL.PARTIAL_MATCH);

    return this.gstBillMatchRepo.upsertByFiling(ctx.tenantId, filing._id, {
      billId: bill._id,
      totalClientBills,
      totalTallyBills,
      matchedCount,
      unmatchedCount,
      extraTallyCount,
      overallStatus,
      results,
      errorMessage: undefined,
      ranAt: new Date(),
    }, ctx.actor.id);
  }

  #result(item, voucher, status, reason) {
    return {
      serialNo: item.serialNo,
      productName: item.productName,
      rate: item.rate,
      tallyVoucherNumber: voucher?.voucherNumber ?? null,
      tallyAmount: voucher?.amount ?? null,
      status,
      reason,
    };
  }

  /** A TECHNICAL failure (Tally unreachable / not configured / misconfigured) is never reported as a
   * business MISMATCH (spec Step 25) — every line is marked ERROR with the same explanatory reason. */
  async #persistError(ctx, filing, bill, message, errorCode) {
    const results = bill.items.map((item) => this.#result(item, null, S.ERROR, 'Tally data could not be retrieved.'));
    const saved = await this.gstBillMatchRepo.upsertByFiling(ctx.tenantId, filing._id, {
      billId: bill._id,
      totalClientBills: bill.items.length,
      totalTallyBills: 0,
      matchedCount: 0,
      unmatchedCount: bill.items.length,
      extraTallyCount: 0,
      overallStatus: OVERALL.TALLY_ERROR,
      results,
      errorMessage: message,
      ranAt: new Date(),
    }, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.TALLY_MATCH_FAILED, resourceType: 'GSTFiling', resourceId: filing._id, tenantId: ctx.tenantId, metadata: { errorCode, message },
    });
    return saved;
  }
}
