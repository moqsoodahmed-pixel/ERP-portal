import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { AUDIT_ACTIONS } from '../constants/statuses.js';

const sanitizeFileName = (invoiceNumber) => `${String(invoiceNumber ?? 'invoice').replace(/[^A-Za-z0-9-_]/g, '_').slice(0, 60)}.pdf`;
const storageKeyFor = (tenantId, invoiceId, documentId) => `tenant/${tenantId}/invoices/${invoiceId}/${documentId}.pdf`;

/**
 * Orchestrates Invoice -> PDF Service -> Document (metadata) -> Storage (bytes).
 *
 * Idempotency strategy (see spec step 9): exactly one "current" Document row per invoice is enforced by
 * a unique index on (tenantId, entityType, entityId, documentType). The first generation request upserts
 * that row with `createIfAbsent`; a concurrent duplicate request loses the DB race (E11000 / upsert no-op),
 * re-reads the winner's row, and deletes its own now-orphaned file from storage so bytes are never left
 * unreferenced. Reconciliation: storage is written BEFORE metadata is written, so a document row is only
 * ever considered "available" once both steps have succeeded; if the metadata write fails after a
 * successful storage write, the just-written file is deleted so nothing "available" is left dangling.
 *
 * DRAFT invoices are never persisted as official documents (drafts are mutable, so nothing would be safe
 * to reuse) — every DRAFT view/generate call re-renders directly from the live draft and streams it back.
 * ISSUED/CANCELLED invoices are backed by a real Document row, generated once and reused (idempotent)
 * for as long as the invoice's status hasn't changed; a status change (e.g. ISSUED -> CANCELLED) or an
 * explicit regenerate request overwrites that same row in place rather than creating a new one.
 */
export class DocumentService {
  constructor({ documentRepo, storageService, pdfService, auditService }) {
    Object.assign(this, { documentRepo, storageService, pdfService, auditService });
  }

  /** DRAFT only: always a fresh render, never persisted/versioned. */
  async previewDraft(ctx, invoice) {
    const buffer = await this.pdfService.generate(invoice);
    await this.auditService.record(ctx, {
      action: AUDIT_ACTIONS.INVOICE_PDF_GENERATED, resourceType: 'Invoice', resourceId: invoice._id, metadata: { invoiceStatus: invoice.invoiceStatus, persisted: false },
    });
    return { buffer, fileName: sanitizeFileName(invoice.invoiceNumber) };
  }

  /** ISSUED / CANCELLED: generate once, persist, and reuse while the invoice status is unchanged. */
  async getOrGenerate(ctx, invoice, { forceRegenerate = false } = {}) {
    const existing = await this.documentRepo.findCurrent(ctx.tenantId, 'INVOICE', invoice._id, 'INVOICE_PDF');
    if (existing && !forceRegenerate && existing.generatedForStatus === invoice.invoiceStatus) {
      const buffer = await this.storageService.read(existing.storageKey);
      await this.auditService.record(ctx, {
        action: AUDIT_ACTIONS.INVOICE_PDF_ACCESSED, resourceType: 'Invoice', resourceId: invoice._id, metadata: { documentId: existing._id },
      });
      return { buffer, document: existing, fileName: existing.fileName };
    }
    const document = await this.#generateAndPersist(ctx, invoice, existing);
    const buffer = await this.storageService.read(document.storageKey);
    await this.auditService.record(ctx, {
      action: existing ? AUDIT_ACTIONS.INVOICE_PDF_REGENERATED : AUDIT_ACTIONS.INVOICE_PDF_GENERATED,
      resourceType: 'Invoice', resourceId: invoice._id, metadata: { documentId: document._id, checksum: document.checksum },
    });
    return { buffer, document, fileName: document.fileName };
  }

  async #generateAndPersist(ctx, invoice, existing) {
    const buffer = await this.pdfService.generate(invoice);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const documentId = existing ? String(existing._id) : String(new mongoose.Types.ObjectId());
    const storageKey = storageKeyFor(ctx.tenantId, invoice._id, documentId);

    // Storage write happens first: a Document row is only ever written once the bytes it points to exist.
    await this.storageService.save(storageKey, buffer);

    const fields = {
      documentType: 'INVOICE_PDF', entityType: 'INVOICE', entityId: String(invoice._id),
      fileName: sanitizeFileName(invoice.invoiceNumber), mimeType: 'application/pdf', storageProvider: 'LOCAL',
      storageKey, fileSize: buffer.length, checksum, generatedForStatus: invoice.invoiceStatus, generatedBy: ctx.actor.id,
    };

    try {
      if (existing) {
        return await this.documentRepo.replaceCurrent(ctx.tenantId, existing._id, {
          ...fields, version: (existing.version ?? 1) + 1, updatedBy: ctx.actor.id,
        });
      }
      const { doc, created } = await this.documentRepo.createIfAbsent(ctx.tenantId, {
        ...fields, _id: documentId, version: 1, createdBy: ctx.actor.id, updatedBy: ctx.actor.id,
      });
      // Lost a concurrent create race: the winning row points at different bytes. Don't leave our copy dangling.
      if (!created && doc.storageKey !== storageKey) await this.storageService.delete(storageKey);
      return doc;
    } catch (err) {
      await this.storageService.delete(storageKey).catch(() => {});
      throw err;
    }
  }
}
