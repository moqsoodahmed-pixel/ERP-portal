import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { AUDIT_ACTIONS, INVOICE_STATUS, PAYMENT_STATUS, TALLY_SYNC_STATUS, GST_FILING_STATUS } from '../constants/statuses.js';
import { ID_PREFIX } from '../constants/pagination.js';
import { formatCode } from '../utils/codes.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

export class InvoiceService {
  constructor({ invoiceRepo, customerRepo, productRepo, counterRepo, calculator, auditService, businessProfileRepo, notificationService = null }) {
    Object.assign(this, { invoiceRepo, customerRepo, productRepo, counterRepo, calculator, auditService, businessProfileRepo, notificationService });
  }

  async list(ctx, query) {
    const p = parsePagination(query);
    const filter = {};
    if (query.status) filter.invoiceStatus = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    const r = await this.invoiceRepo.findPage(ctx.tenantId, {
      ...p, search: query.search, filter, sort: parseSort(query.sort, ['invoiceNumber', 'invoiceDate', 'grandTotal', 'createdAt']),
      dateRange: { from: query.from, to: query.to },
    });
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async get(ctx, id) {
    const invoice = await this.invoiceRepo.findOneById(ctx.tenantId, id);
    if (!invoice) throw new NotFoundError('Invoice not found');
    return invoice;
  }

  /**
   * The ONLY entry point Tally (or any other external-integration) code may use to read invoice data.
   * Returns the authoritative, already-frozen ISSUED invoice (snapshots + computed totals) and nothing
   * else — callers never see draft data and never get a reason to re-derive GST themselves.
   * Cancelled-but-already-synced invoices are a documented future enhancement (reversal/adjustment
   * voucher) and are NOT un-synced here; a cancelled, never-synced invoice stays ineligible.
   */
  async getIssuedInvoiceForTally(ctx, id) {
    const invoice = await this.get(ctx, id);
    if (invoice.invoiceStatus !== INVOICE_STATUS.ISSUED) {
      throw new ConflictError('Only ISSUED invoices can be synced to Tally', 'TALLY_INVOICE_NOT_ISSUED');
    }
    return invoice;
  }

  /** Shared by create() and update(): resolves tenant-scoped customer/products, runs the GST engine, and builds frozen snapshots. */
  async _resolve(ctx, dto) {
    const profile = await this.businessProfileRepo.findByTenant(ctx.tenantId);
    if (!profile) throw new ValidationError('Business profile must be configured before creating invoices');

    // Every referenced record is resolved THROUGH the tenant-scoped repositories: foreign/cross-tenant/archived ids simply do not exist for this tenant.
    const customer = await this.customerRepo.findOneById(ctx.tenantId, dto.customerId);
    if (!customer) throw new NotFoundError('Customer not found');
    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.productRepo.findManyByIds(ctx.tenantId, productIds);
    const byId = new Map(products.map((p) => [String(p._id), p]));
    if (byId.size !== productIds.length) throw new NotFoundError('One or more products were not found');

    const resolved = dto.items.map((item) => {
      const product = byId.get(item.productId);
      if (product.status !== 'ACTIVE') throw new ValidationError(`Product ${product.productCode} is not active`);
      return {
        item, product,
        calc: {
          quantity: item.quantity, unitPrice: item.unitPrice ?? String(product.sellingPrice), discount: item.discount,
          gstRate: item.gstRate ?? (product.isGstApplicable ? product.gstRate : 0),
          cessRate: item.cessRate ?? 0,
        },
      };
    });
    const { lines, totals } = this.calculator.calculate({ items: resolved.map((r) => r.calc), gstApplicable: dto.gstApplicable, interState: dto.interState });

    const customerSnapshot = {
      name: customer.name, businessName: customer.businessName, customerCode: customer.customerCode, gstin: customer.gstin, pan: customer.pan,
      email: customer.email, phone: customer.phone, billingAddress: customer.billingAddress, shippingAddress: customer.shippingAddress,
      state: customer.state, stateCode: customer.billingAddress?.stateCode, pincode: customer.pincode,
    };
    const supplierSnapshot = {
      businessName: profile.displayName, gstin: profile.gstin, address: profile.address, stateCode: profile.address?.stateCode,
      email: profile.email, mobile: profile.mobile,
    };
    // Phase 22: letterhead is frozen at creation time too — only FileMetadata ids are copied, never bytes
    // (see letterheadSnapshotSchema doc comment in models/business.js).
    const letterheadSnapshot = {
      logoFileId: profile.logoFileId, backgroundFileId: profile.letterheadBackgroundFileId, watermarkFileId: profile.watermarkFileId,
      signatureFileId: profile.signatureFileId, sealFileId: profile.sealFileId, qrCodeFileId: profile.qrCodeFileId,
      bankDetails: profile.bankDetails, footerText: profile.footerText, declaration: profile.declaration,
      authorizedSignatoryName: profile.authorizedSignatoryName, authorizedSignatoryDesignation: profile.authorizedSignatoryDesignation,
    };

    const items = resolved.map((r, idx) => ({
      lineNo: idx + 1, productId: r.item.productId, productCode: r.product.productCode, productName: r.product.productName,
      description: r.item.description ?? r.product.productName,
      hsnSacCode: r.product.hsnSacCode, unit: r.product.unit, quantity: r.calc.quantity, unitPrice: r.calc.unitPrice, discount: r.calc.discount ?? '0.00',
      ...lines[idx],
    }));

    return {
      customerId: dto.customerId, invoiceDate: dto.invoiceDate, dueDate: dto.dueDate, notes: dto.notes,
      termsAndConditions: dto.termsAndConditions ?? profile.defaultTermsAndConditions,
      placeOfSupplyStateCode: dto.placeOfSupplyStateCode ?? customerSnapshot.stateCode,
      gstApplicable: dto.gstApplicable, interState: Boolean(dto.interState),
      customerSnapshot, supplierSnapshot, letterheadSnapshot, items, ...totals,
    };
  }

  async create(ctx, dto) {
    const built = await this._resolve(ctx, dto);
    const invoiceNumber = formatCode(ID_PREFIX.invoice, await this.counterRepo.next(ctx.tenantId, 'invoice'));
    const invoice = await this.invoiceRepo.create(ctx.tenantId, {
      invoiceNumber, ...built,
      invoiceStatus: INVOICE_STATUS.DRAFT, paymentStatus: PAYMENT_STATUS.UNPAID,
      tallySyncStatus: TALLY_SYNC_STATUS.NOT_SYNCED, gstFilingStatus: GST_FILING_STATUS.PENDING,
    }, ctx.actor.id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.INVOICE_CREATED, resourceType: 'Invoice', resourceId: invoice._id, metadata: { invoiceNumber, gstApplicable: dto.gstApplicable } });
    return invoice;
  }

  /** Only DRAFT invoices are editable. Re-resolves customer/products and recomputes everything — the client never supplies totals. */
  async update(ctx, id, dto) {
    const current = await this.get(ctx, id);
    if (current.invoiceStatus !== INVOICE_STATUS.DRAFT) throw new ConflictError('Only DRAFT invoices can be edited', 'INVOICE_NOT_DRAFT');
    const built = await this._resolve(ctx, dto);
    const updated = await this.invoiceRepo.conditionalUpdate(
      ctx.tenantId, id, { invoiceStatus: INVOICE_STATUS.DRAFT }, { ...built, updatedBy: ctx.actor.id },
    );
    if (!updated) throw new ConflictError('Invoice is no longer a DRAFT and cannot be edited', 'INVOICE_NOT_DRAFT');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.INVOICE_UPDATED, resourceType: 'Invoice', resourceId: id, metadata: { invoiceNumber: updated.invoiceNumber } });
    return updated;
  }

  /**
   * DRAFT -> ISSUED. Recomputes authoritative totals from the invoice's own stored line data (never trusts
   * anything the request body might carry) and freezes the invoice: no further mutation of snapshots/items/
   * totals/invoiceNumber/invoiceDate is possible after this point, only a status transition to CANCELLED.
   * The `invoiceStatus: DRAFT` precondition inside conditionalUpdate makes concurrent double-issue lose the race.
   */
  async issue(ctx, id) {
    const current = await this.get(ctx, id);
    if (current.invoiceStatus !== INVOICE_STATUS.DRAFT) throw new ConflictError('Only DRAFT invoices can be issued', 'INVOICE_NOT_DRAFT');
    // Line fields come back from Mongo as Decimal128/lean values, not the plain strings the calculator expects.
    const { lines, totals } = this.calculator.calculate({
      items: current.items.map((it) => ({
        quantity: String(it.quantity), unitPrice: String(it.unitPrice), discount: String(it.discount ?? 0), gstRate: it.gstRate, cessRate: it.cessRate ?? 0,
      })),
      gstApplicable: current.gstApplicable, interState: current.interState,
    });
    const items = current.items.map((it, idx) => ({ ...it, ...lines[idx] }));
    const updated = await this.invoiceRepo.conditionalUpdate(ctx.tenantId, id, { invoiceStatus: INVOICE_STATUS.DRAFT }, {
      invoiceStatus: INVOICE_STATUS.ISSUED, issuedBy: ctx.actor.id, issuedAt: new Date(), updatedBy: ctx.actor.id, items, ...totals,
    });
    if (!updated) throw new ConflictError('Invoice is no longer a DRAFT and cannot be issued', 'INVOICE_NOT_DRAFT');
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.INVOICE_ISSUED, resourceType: 'Invoice', resourceId: id, metadata: { invoiceNumber: updated.invoiceNumber } });
    // Phase 9: only reached by the request that actually won the DRAFT->ISSUED conditional update.
    await this.notificationService?.invoiceIssued(updated);
    return updated;
  }

  /** Invoices are cancelled, never deleted. Allowed from DRAFT or ISSUED; terminal once CANCELLED. */
  async cancel(ctx, id, reason) {
    const current = await this.get(ctx, id);
    if (current.invoiceStatus === INVOICE_STATUS.CANCELLED) throw new ConflictError('Invoice is already cancelled', 'INVOICE_ALREADY_CANCELLED');
    const updated = await this.invoiceRepo.conditionalUpdate(
      ctx.tenantId, id, { invoiceStatus: { $in: [INVOICE_STATUS.DRAFT, INVOICE_STATUS.ISSUED] } },
      {
        invoiceStatus: INVOICE_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: ctx.actor.id, cancellationReason: reason, updatedBy: ctx.actor.id,
      },
    );
    if (!updated) throw new ConflictError('Invoice is already cancelled', 'INVOICE_ALREADY_CANCELLED');
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.INVOICE_CANCELLED, resourceType: 'Invoice', resourceId: id, metadata: { previous: current.invoiceStatus, next: INVOICE_STATUS.CANCELLED, reason },
    });
    await this.notificationService?.invoiceCancelled(updated);
    return updated;
  }
}
