import { NotFoundError } from '../../utils/errors.js';

/**
 * Phase 13 — Tally Public API (Tally/TDL -> ERP direction). Deliberately a thin projection layer: every
 * read delegates to the SAME authoritative tenant-scoped service Phase 1-9 already uses
 * (businessProfileService/productService/customerService/invoiceService), and the sync endpoint delegates
 * to the SAME TallySyncService Phase 6 uses for ERP -> Tally. No business logic, GST calculation, or sync
 * logic is duplicated here — this class only shapes responses to the fields Tally/TDL actually needs and
 * strips everything else (internal audit fields, snapshots' full nested detail where unnecessary, etc).
 */
export class TallyPublicApiService {
  constructor({ businessProfileService, productService, customerService, invoiceService, tallySyncService }) {
    Object.assign(this, { businessProfileService, productService, customerService, invoiceService, tallySyncService });
  }

  async company(ctx) {
    const profile = await this.businessProfileService.get(ctx);
    return {
      companyName: profile.displayName,
      gstin: profile.gstin ?? null,
      state: profile.address?.state ?? null,
      stateCode: profile.address?.stateCode ?? null,
    };
  }

  async customers(ctx, query) {
    const { items, pagination } = await this.customerService.list(ctx, query);
    return {
      items: items.map((c) => ({
        id: c._id, customerCode: c.customerCode, name: c.name, businessName: c.businessName ?? null,
        gstin: c.gstin ?? null, pan: c.pan ?? null, billingAddress: c.billingAddress ?? null, status: c.status,
        updatedAt: c.updatedAt,
      })),
      pagination,
    };
  }

  async products(ctx, query) {
    const { items, pagination } = await this.productService.list(ctx, query);
    return {
      items: items.map((p) => ({
        id: p._id, productCode: p.productCode, productName: p.productName, hsnSacCode: p.hsnSacCode ?? null,
        unit: p.unit, sellingPrice: p.sellingPrice, gstRate: p.gstRate, isGstApplicable: p.isGstApplicable, status: p.status,
        updatedAt: p.updatedAt,
      })),
      pagination,
    };
  }

  /** Authoritative, stored invoice fields only — never recalculates GST from live customer/product/business-profile data. */
  async invoices(ctx, query) {
    const { items, pagination } = await this.invoiceService.list(ctx, query);
    return { items: items.map(invoiceSummaryView), pagination };
  }

  async invoice(ctx, id) {
    // invoiceService.get() is already tenant-scoped (findOneById), so a Tenant B invoice simply does not
    // exist for a Tenant A API key — it 404s here exactly like it would for a cross-tenant JWT user.
    const invoice = await this.invoiceService.get(ctx, id);
    if (!invoice) throw new NotFoundError('Invoice not found');
    return invoiceDetailView(invoice);
  }

  /** Delegates entirely to the existing Phase 6 TallySyncService — same idempotency, same authorization shape, no duplicated logic. */
  async sync(ctx, id) {
    return this.tallySyncService.sync(ctx, id);
  }
}

function invoiceSummaryView(inv) {
  return {
    id: inv._id, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate, invoiceStatus: inv.invoiceStatus,
    customerId: inv.customerId, grandTotal: inv.grandTotal, gstApplicable: inv.gstApplicable, interState: inv.interState,
    updatedAt: inv.updatedAt,
  };
}

function invoiceDetailView(inv) {
  return {
    ...invoiceSummaryView(inv),
    items: inv.items, customerSnapshot: inv.customerSnapshot, supplierSnapshot: inv.supplierSnapshot,
    taxableAmount: inv.taxableAmount, cgst: inv.cgst, sgst: inv.sgst, igst: inv.igst, cess: inv.cess,
    paymentStatus: inv.paymentStatus,
  };
}
