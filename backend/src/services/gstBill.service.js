import crypto from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';
import { D, toMoney, moneyString } from '../utils/money.js';
import { ALLOWED_BILL_MIME_TYPES, MAX_BILL_FILE_BYTES } from '../validators/billIntake.validators.js';
import { parsePagination, buildPageMeta } from '../utils/pagination.js';

const GST_RATE = 18;

/**
 * Phase 19 — GST Bill Builder. A simple internal GST sales bill tied 1:1 to a GSTFiling: serial/productName/
 * rate line items, a single flat 18% GST applied to the whole bill (never per-line, never client-settable),
 * and a bill-level document upload (reuses the Phase 5 FileMetadata + StorageService architecture exactly as
 * BillIntakeService#addDocuments does). The frontend may calculate for display, but subtotal/gstAmount/
 * grandTotal are ALWAYS recomputed here from the submitted line items — client-sent totals are never trusted.
 *
 * Phase 19.3 adds `vendorList`: a read-only, cross-tenant projection for an assigned GST_VENDOR (reuses the
 * SAME ACTIVE-assignment set every other vendor "me/*" route derives from — never a tenantId/companyId the
 * frontend supplies). A vendor never gets gst_bills.create/update, so this module adds no new write path.
 */
export class GSTBillService {
  constructor({
    gstBillRepo, fileMetadataRepo, storageService, auditService, assignmentRepo, businessProfileRepo, tenantRepo, gstBillMatchRepo,
  }) {
    Object.assign(this, {
      gstBillRepo, fileMetadataRepo, storageService, auditService, assignmentRepo, businessProfileRepo, tenantRepo, gstBillMatchRepo,
    });
  }

  /** Vendor-facing list: one row per (assigned client's) filing that already has an uploaded bill document —
   * an unuploaded bill is not yet "handed off" to the vendor, so it is deliberately left out (spec step 17). */
  async vendorList(ctx, query) {
    const p = parsePagination(query);
    const assignments = await this.assignmentRepo.listActiveByVendor(ctx.actor.vendorId);
    const tenantIds = [...new Set(assignments.map((a) => String(a.tenantId)))];
    if (!tenantIds.length) return { items: [], pagination: buildPageMeta(p, 0) };

    // Only bills with at least one uploaded document are "handed off" to the vendor (spec step 17); the
    // assigned-client set is small by construction, so filtering in application code after the tenant-scoped
    // fetch is simpler and just as correct as a query-level array-length filter.
    const uploaded = (await this.gstBillRepo.model.find({ tenantId: { $in: tenantIds } }).sort({ updatedAt: -1 }).lean())
      .filter((bill) => bill.documentIds?.length);
    const total = uploaded.length;
    const bills = uploaded.slice(p.skip, p.skip + p.limit);

    const items = await Promise.all(bills.map(async (bill) => {
      const [profile, tenant, documents] = await Promise.all([
        this.businessProfileRepo.findByTenant(bill.tenantId),
        this.tenantRepo.findById(bill.tenantId),
        this.fileMetadataRepo.findManyForTenant(bill.tenantId, bill.documentIds),
      ]);
      return {
        filingId: bill.filingId,
        companyId: tenant?.tenantCode ?? null,
        companyName: profile?.displayName ?? tenant?.businessName ?? 'Unknown company',
        gstin: profile?.gstin ?? null,
        address: profile?.address ?? null,
        documents: documents.map((d) => ({ id: d._id, fileName: d.fileName, mimeType: d.mimeType })),
      };
    }));
    return { items, pagination: buildPageMeta(p, total) };
  }

  async get(ctx, filing) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill) throw new NotFoundError('No bill has been created for this filing yet');
    return this.#withDocuments(ctx.tenantId, bill);
  }

  /** Create-if-absent, else update-in-place (never a duplicate) — the unique (tenantId, filingId) index is
   * the backstop against a concurrent double-create; a lost race falls back to updating the winning row. */
  async save(ctx, filing, dto) {
    const { items, subtotal, gstAmount, grandTotal } = this.#calculate(dto.items);
    const patch = {
      items, gstRate: GST_RATE, subtotal: moneyString(subtotal), gstAmount: moneyString(gstAmount), grandTotal: moneyString(grandTotal),
    };

    const existing = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    let bill;
    let wasCreated = false;
    if (existing) {
      bill = await this.gstBillRepo.updateById(ctx.tenantId, existing._id, patch, ctx.actor.id);
    } else {
      try {
        bill = await this.gstBillRepo.create(ctx.tenantId, { filingId: String(filing._id), documentIds: [], ...patch }, ctx.actor.id);
        wasCreated = true;
      } catch (err) {
        if (err.code !== 11000) throw err;
        const winner = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
        bill = await this.gstBillRepo.updateById(ctx.tenantId, winner._id, patch, ctx.actor.id);
      }
    }

    await this.auditService.record(ctx, {
      action: wasCreated ? AUDIT_ACTIONS.GST_BILL_CREATED : AUDIT_ACTIONS.GST_BILL_UPDATED,
      resourceType: 'GSTBill',
      resourceId: bill._id,
      tenantId: ctx.tenantId,
      metadata: { filingId: String(filing._id), itemCount: items.length },
    });
    return this.#withDocuments(ctx.tenantId, bill);
  }

  /** Server-side recomputation (spec step 25/12) — subtotal/GST/grand total are derived ONLY from the
   * submitted rates, never accepted as-is from the client. Serial numbers are always 1..n by submission order. */
  #calculate(rawItems) {
    let subtotal = toMoney(0);
    const items = rawItems.map((it, idx) => {
      const rate = toMoney(new D(it.rate));
      subtotal = subtotal.plus(rate);
      return { serialNo: idx + 1, productName: it.productName.trim(), rate: moneyString(rate) };
    });
    const gstAmount = toMoney(subtotal.mul(GST_RATE).div(100));
    const grandTotal = subtotal.plus(gstAmount);
    return {
      items, subtotal, gstAmount, grandTotal,
    };
  }

  // ---------------------------------------------------------------- documents (reuses Phase 5 FileMetadata + StorageService, same pattern as BillIntakeService#addDocuments)
  async addDocuments(ctx, filing, files) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill) throw new ValidationError('Save the bill before uploading a document');
    const created = [];
    for (const f of files) {
      const buffer = Buffer.from(f.contentBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_BILL_FILE_BYTES) throw new ValidationError('Each document must be between 1 byte and 5MB');
      if (!ALLOWED_BILL_MIME_TYPES.includes(f.mimeType)) throw new ValidationError('Unsupported document type');
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileId = crypto.randomUUID();
      // Unguessable, server-derived key (tenant + random id) — never built from the client-supplied fileName.
      const storageKey = `tenant/${ctx.tenantId}/gst-bills/${bill._id}/${fileId}`;
      await this.storageService.save(storageKey, buffer);
      try {
        const doc = await this.fileMetadataRepo.createForTenant(ctx.tenantId, {
          uploadedBy: ctx.actor.id, fileName: String(f.fileName).slice(0, 255), mimeType: f.mimeType, size: buffer.length,
          storageProvider: 'LOCAL_DEV', storageKey, checksum, purpose: 'GST_BILL_DOCUMENT', entityType: 'GST_BILL', entityId: String(bill._id),
        });
        created.push(doc);
      } catch (err) {
        await this.storageService.delete(storageKey).catch(() => {});
        throw err;
      }
    }
    const documentIds = [...(bill.documentIds ?? []), ...created.map((d) => String(d._id))];
    const updated = await this.gstBillRepo.updateById(ctx.tenantId, bill._id, { documentIds }, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.GST_BILL_DOCUMENT_UPLOADED, resourceType: 'GSTBill', resourceId: bill._id, tenantId: ctx.tenantId, metadata: { filingId: String(filing._id), count: created.length },
    });
    return this.#withDocuments(ctx.tenantId, updated);
  }

  async getDocument(ctx, filing, docId) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill || !bill.documentIds?.map(String).includes(String(docId))) throw new NotFoundError('Document not found on this bill');
    const meta = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, docId);
    if (!meta) throw new NotFoundError('Document not found on this bill');
    const buffer = await this.storageService.read(meta.storageKey);
    return { buffer, mimeType: meta.mimeType, fileName: meta.fileName };
  }

  // ---------------------------------------------------------------- vendor final document (Phase 21; a SEPARATE document/array from the client's own bill upload above — see GSTBill.finalDocumentIds doc comment)
  /**
   * Gating rule (spec step 6's "preferred behaviour"): Tally matching for this filing must already be
   * FULLY_MATCHED (Phase 20's own, unmodified GSTBillMatch record) before a vendor may upload the final
   * document — this reuses Phase 20's existing result rather than inventing a new approval state machine.
   */
  async addFinalDocument(ctx, filing, files) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill) throw new ValidationError('The client has not created a bill for this filing yet');
    const match = await this.gstBillMatchRepo.findByFiling(ctx.tenantId, filing._id);
    if (!match || match.overallStatus !== 'FULLY_MATCHED') {
      throw new ConflictError('Tally matching must be fully matched before uploading the final document', 'GST_MATCHING_NOT_COMPLETE');
    }
    const created = [];
    for (const f of files) {
      const buffer = Buffer.from(f.contentBase64, 'base64');
      if (buffer.length === 0 || buffer.length > MAX_BILL_FILE_BYTES) throw new ValidationError('Each document must be between 1 byte and 5MB');
      if (!ALLOWED_BILL_MIME_TYPES.includes(f.mimeType)) throw new ValidationError('Unsupported document type');
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileId = crypto.randomUUID();
      // Unguessable, server-derived key — a DIFFERENT path from the client's own documents (never overwrites them).
      const storageKey = `tenant/${ctx.tenantId}/gst-bills/${bill._id}/final-${fileId}`;
      await this.storageService.save(storageKey, buffer);
      try {
        const doc = await this.fileMetadataRepo.createForTenant(ctx.tenantId, {
          uploadedBy: ctx.actor.id, fileName: String(f.fileName).slice(0, 255), mimeType: f.mimeType, size: buffer.length,
          storageProvider: 'LOCAL_DEV', storageKey, checksum, purpose: 'VENDOR_FINAL_DOCUMENT', entityType: 'GST_BILL', entityId: String(bill._id),
        });
        created.push(doc);
      } catch (err) {
        await this.storageService.delete(storageKey).catch(() => {});
        throw err;
      }
    }
    // Append-only: previous final documents are preserved (spec step 12/35 — no silent deletion/history loss).
    const finalDocumentIds = [...(bill.finalDocumentIds ?? []), ...created.map((d) => String(d._id))];
    const updated = await this.gstBillRepo.updateById(ctx.tenantId, bill._id, { finalDocumentIds }, ctx.actor.id);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.GST_FINAL_DOCUMENT_UPLOADED, resourceType: 'GSTBill', resourceId: bill._id, tenantId: ctx.tenantId, metadata: { filingId: String(filing._id), count: created.length },
    });
    return this.#withDocuments(ctx.tenantId, updated);
  }

  /** Client/vendor/master-facing list — a filing with no bill yet (or no final document yet) simply
   * returns an empty list, never an error, so the client dashboard's empty state reads cleanly. */
  async getFinalDocuments(ctx, filing) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill?.finalDocumentIds?.length) return { items: [] };
    const docs = await this.fileMetadataRepo.findManyForTenant(ctx.tenantId, bill.finalDocumentIds);
    return { items: docs.map(mapDocMeta) };
  }

  async getFinalDocument(ctx, filing, docId) {
    const bill = await this.gstBillRepo.findByFiling(ctx.tenantId, filing._id);
    if (!bill || !bill.finalDocumentIds?.map(String).includes(String(docId))) throw new NotFoundError('Document not found on this filing');
    const meta = await this.fileMetadataRepo.findOneForTenant(ctx.tenantId, docId);
    if (!meta) throw new NotFoundError('Document not found on this filing');
    const buffer = await this.storageService.read(meta.storageKey);
    return { buffer, mimeType: meta.mimeType, fileName: meta.fileName };
  }

  async #withDocuments(tenantId, bill) {
    const [documents, finalDocuments] = await Promise.all([
      bill.documentIds?.length ? this.fileMetadataRepo.findManyForTenant(tenantId, bill.documentIds) : [],
      bill.finalDocumentIds?.length ? this.fileMetadataRepo.findManyForTenant(tenantId, bill.finalDocumentIds) : [],
    ]);
    return {
      ...bill,
      documents: documents.map(mapDocMeta),
      finalDocuments: finalDocuments.map(mapDocMeta),
    };
  }
}

function mapDocMeta(d) {
  return {
    id: d._id, fileName: d.fileName, mimeType: d.mimeType, size: d.size, uploadedAt: d.createdAt,
  };
}
