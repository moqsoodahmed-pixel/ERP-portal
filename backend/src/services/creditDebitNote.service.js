import { ConflictError, NotFoundError } from '../utils/errors.js';
import { AUDIT_ACTIONS, INVOICE_STATUS, NOTE_STATUS, NOTE_TYPE } from '../constants/statuses.js';
import { ID_PREFIX } from '../constants/pagination.js';
import { formatCode } from '../utils/codes.js';
import { parsePagination, parseSort, buildPageMeta } from '../utils/pagination.js';

/**
 * Phase 22 — Credit/Debit Notes. The only way to "amend" an already-ISSUED, immutable Invoice: never an
 * edit to the invoice itself, always a new, independently-numbered document referencing it. Reuses the
 * invoice's own frozen customer/supplier snapshots and the SAME InvoiceCalculationService — no parallel tax
 * engine, no client-supplied totals (the validator is `.strict()` with the same item shape as invoiceCreate).
 */
export class CreditDebitNoteService {
  constructor({ noteRepo, invoiceRepo, productRepo, counterRepo, calculator, auditService }) {
    Object.assign(this, { noteRepo, invoiceRepo, productRepo, counterRepo, calculator, auditService });
  }

  async list(ctx, query) {
    const p = parsePagination(query);
    const filter = {};
    if (query.noteType) filter.noteType = query.noteType;
    if (query.invoiceId) filter.invoiceId = query.invoiceId;
    const r = await this.noteRepo.findPage(ctx.tenantId, {
      ...p, search: query.search, filter, sort: parseSort(query.sort, ['noteNumber', 'noteDate', 'grandTotal', 'createdAt']),
      dateRange: { from: query.from, to: query.to },
    });
    return { items: r.items, pagination: buildPageMeta(p, r.total) };
  }

  async get(ctx, id) {
    const note = await this.noteRepo.findOneById(ctx.tenantId, id);
    if (!note) throw new NotFoundError('Note not found');
    return note;
  }

  listByInvoice(ctx, invoiceId) {
    return this.noteRepo.findByInvoice(ctx.tenantId, invoiceId);
  }

  /** Shared by createCreditNote/createDebitNote: validates the parent invoice, resolves products, runs the GST engine. */
  async _create(ctx, invoiceId, noteType, dto) {
    const invoice = await this.invoiceRepo.findOneById(ctx.tenantId, invoiceId);
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (invoice.invoiceStatus !== INVOICE_STATUS.ISSUED) {
      throw new ConflictError('A credit/debit note can only be created against an ISSUED invoice', 'INVOICE_NOT_ISSUED');
    }

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.productRepo.findManyByIds(ctx.tenantId, productIds);
    const byId = new Map(products.map((p) => [String(p._id), p]));
    if (byId.size !== productIds.length) throw new NotFoundError('One or more products were not found');

    const resolved = dto.items.map((item) => {
      const product = byId.get(item.productId);
      return {
        item, product,
        calc: {
          quantity: item.quantity, unitPrice: item.unitPrice ?? String(product.sellingPrice), discount: item.discount,
          gstRate: item.gstRate ?? (product.isGstApplicable ? product.gstRate : 0), cessRate: item.cessRate ?? 0,
        },
      };
    });
    // Tax treatment (gstApplicable/interState) always follows the parent invoice — never re-specified by the caller.
    const { lines, totals } = this.calculator.calculate({
      items: resolved.map((r) => r.calc), gstApplicable: invoice.gstApplicable, interState: invoice.interState,
    });
    const items = resolved.map((r, idx) => ({
      lineNo: idx + 1, productId: r.item.productId, productCode: r.product.productCode, productName: r.product.productName,
      description: r.item.description ?? r.product.productName,
      hsnSacCode: r.product.hsnSacCode, unit: r.product.unit, quantity: r.calc.quantity, unitPrice: r.calc.unitPrice, discount: r.calc.discount ?? '0.00',
      ...lines[idx],
    }));

    const prefix = noteType === NOTE_TYPE.CREDIT ? ID_PREFIX.creditNote : ID_PREFIX.debitNote;
    const counterName = noteType === NOTE_TYPE.CREDIT ? 'creditNote' : 'debitNote';
    const noteNumber = formatCode(prefix, await this.counterRepo.next(ctx.tenantId, counterName));

    const note = await this.noteRepo.create(ctx.tenantId, {
      noteNumber, noteType, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, customerId: invoice.customerId,
      customerSnapshot: invoice.customerSnapshot, supplierSnapshot: invoice.supplierSnapshot, letterheadSnapshot: invoice.letterheadSnapshot,
      noteDate: dto.noteDate, reason: dto.reason, items,
      gstApplicable: invoice.gstApplicable, interState: invoice.interState,
      status: NOTE_STATUS.ISSUED, issuedBy: ctx.actor.id, ...totals,
    }, ctx.actor.id);

    await this.auditService.record(ctx, {
      action: noteType === NOTE_TYPE.CREDIT ? AUDIT_ACTIONS.CREDIT_NOTE_CREATED : AUDIT_ACTIONS.DEBIT_NOTE_CREATED,
      resourceType: 'CreditDebitNote', resourceId: note._id, metadata: { noteNumber, invoiceNumber: invoice.invoiceNumber },
    });
    return note;
  }

  createCreditNote(ctx, invoiceId, dto) { return this._create(ctx, invoiceId, NOTE_TYPE.CREDIT, dto); }
  createDebitNote(ctx, invoiceId, dto) { return this._create(ctx, invoiceId, NOTE_TYPE.DEBIT, dto); }

  /** ISSUED -> CANCELLED only; terminal once cancelled. Notes are voided, never deleted (never re-DRAFTable either). */
  async cancel(ctx, id, reason) {
    const current = await this.get(ctx, id);
    if (current.status !== NOTE_STATUS.ISSUED) throw new ConflictError('Only an ISSUED note can be cancelled', 'NOTE_NOT_ISSUED');
    const updated = await this.noteRepo.conditionalUpdate(ctx.tenantId, id, { status: NOTE_STATUS.ISSUED }, {
      status: NOTE_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: ctx.actor.id, cancellationReason: reason, updatedBy: ctx.actor.id,
    });
    if (!updated) throw new ConflictError('Note is no longer ISSUED and cannot be cancelled', 'NOTE_NOT_ISSUED');
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.CREDIT_DEBIT_NOTE_CANCELLED, resourceType: 'CreditDebitNote', resourceId: id,
      metadata: { noteNumber: updated.noteNumber, reason },
    });
    return updated;
  }
}
