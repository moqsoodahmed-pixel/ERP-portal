import { IntegrationError, ValidationError } from '../../utils/errors.js';
import { TALLY_ERROR_CODES } from './tally.constants.js';

function toDateStamp(d) {
  const date = new Date(d);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * ERP invoice -> Tally voucher payload mapping. Reads ONLY the invoice's own frozen fields
 * (customerSnapshot, supplierSnapshot, items[], total*) — it never re-queries Customer/Product/
 * BusinessProfile and never recomputes GST. This is what keeps historical vouchers reproducible even
 * after the live customer/product/business-profile records change (see invoiceLifecycle.test.js's
 * "historical snapshot" test and tally.mapper.test.js's equivalent for Tally payloads).
 */
export class TallyMapper {
  mapInvoice(integration, invoice) {
    if (invoice.invoiceStatus !== 'ISSUED') {
      // Defence in depth: TallySyncService already enforces this before calling the mapper.
      throw new IntegrationError('Only ISSUED invoices can be mapped to a Tally voucher', TALLY_ERROR_CODES.INVOICE_NOT_ISSUED, 409);
    }
    const required = ['salesLedger'];
    const missing = required.filter((k) => !integration[k]);
    if (missing.length) throw new IntegrationError(`Tally ledger mapping is incomplete: ${missing.join(', ')}`, TALLY_ERROR_CODES.MAPPING_MISSING, 422);

    const items = (invoice.items ?? []).map((it) => ({
      productName: it.productName, hsnSacCode: it.hsnSacCode, quantity: it.quantity, unitPrice: it.unitPrice, taxableAmount: it.taxableAmount,
    }));

    return {
      voucherType: integration.defaultVoucherType || 'Sales',
      voucherDate: toDateStamp(invoice.invoiceDate),
      invoiceNumber: invoice.invoiceNumber,
      partyLedger: invoice.customerSnapshot?.businessName || invoice.customerSnapshot?.name || 'Unknown Customer',
      buyerName: invoice.customerSnapshot?.name,
      buyerGstin: invoice.customerSnapshot?.gstin,
      supplierGstin: invoice.supplierSnapshot?.gstin,
      narration: `Invoice ${invoice.invoiceNumber}`,
      taxableAmount: invoice.taxableAmount,
      cgst: invoice.cgst ?? '0.00',
      sgst: invoice.sgst ?? '0.00',
      igst: invoice.igst ?? '0.00',
      roundOff: '0.00',
      discount: invoice.discount ?? '0.00',
      grandTotal: invoice.grandTotal,
      items,
    };
  }

  /** Validates a ledger-mapping patch has no empty/whitespace-only names. Throws ValidationError, not a 500. */
  static assertLedgerNames(mapping = {}) {
    for (const [k, v] of Object.entries(mapping)) {
      if (v !== undefined && v !== null && String(v).trim() === '') throw new ValidationError(`Ledger name for ${k} cannot be blank`);
    }
  }
}
