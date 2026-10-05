import { create } from 'xmlbuilder2';

/**
 * Builds Tally's "XML over HTTP" request envelope (ENVELOPE/HEADER/BODY/IMPORTDATA/...) for a sales
 * voucher. Uses xmlbuilder2 exclusively — no string concatenation of invoice/customer data into XML, so
 * values containing `<`, `&`, `"` etc. (e.g. a customer name with an ampersand) are escaped correctly by
 * the library instead of corrupting the document or enabling XML injection.
 *
 * `mapped` is the plain-object result of TallyMapper.mapInvoice() — already derived solely from the
 * invoice's frozen snapshot, never re-queried from live data.
 */
export function buildVoucherRequestXml(integration, mapped) {
  const ledgerEntries = [
    { ledgerName: mapped.partyLedger, amount: -mapped.grandTotal, isPartyLedger: true },
    { ledgerName: integration.salesLedger, amount: mapped.taxableAmount },
  ];
  if (Number(mapped.cgst) > 0) ledgerEntries.push({ ledgerName: integration.cgstLedger, amount: mapped.cgst });
  if (Number(mapped.sgst) > 0) ledgerEntries.push({ ledgerName: integration.sgstLedger, amount: mapped.sgst });
  if (Number(mapped.igst) > 0) ledgerEntries.push({ ledgerName: integration.igstLedger, amount: mapped.igst });
  if (Number(mapped.roundOff) !== 0 && integration.roundOffLedger) ledgerEntries.push({ ledgerName: integration.roundOffLedger, amount: mapped.roundOff });
  // Phase 17: discount ledger is optional and additive — only posted when both a non-zero invoice-level
  // discount exists AND a discountLedger is configured. GST amounts themselves are never recomputed here
  // (Phase 4's InvoiceCalculationService remains the sole source of truth); this only decides which ledger
  // name the already-frozen discount amount is posted against.
  if (Number(mapped.discount) > 0 && integration.discountLedger) ledgerEntries.push({ ledgerName: integration.discountLedger, amount: -mapped.discount });

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('ENVELOPE')
      .ele('HEADER').ele('TALLYREQUEST').txt('Import Data').up().up()
      .ele('BODY')
        .ele('IMPORTDATA')
          .ele('REQUESTDESC')
            .ele('REPORTNAME').txt('Vouchers').up()
            .ele('STATICVARIABLES').ele('SVCURRENTCOMPANY').txt(integration.companyName ?? '').up().up()
          .up()
          .ele('REQUESTDATA')
            .ele('TALLYMESSAGE', { 'xmlns:UDF': 'TallyUDF' })
              .ele('VOUCHER', { VCHTYPE: mapped.voucherType, ACTION: 'Create' })
                .ele('DATE').txt(mapped.voucherDate).up()
                .ele('VOUCHERTYPENAME').txt(mapped.voucherType).up()
                .ele('VOUCHERNUMBER').txt(mapped.invoiceNumber).up()
                .ele('PARTYLEDGERNAME').txt(mapped.partyLedger).up()
                .ele('NARRATION').txt(mapped.narration ?? '').up()
                .ele('BASICBUYERNAME').txt(mapped.buyerName ?? '').up()
                .ele('PARTYGSTIN').txt(mapped.buyerGstin ?? '').up();

  for (const line of ledgerEntries) {
    doc.ele('ALLLEDGERENTRIES.LIST')
      .ele('LEDGERNAME').txt(line.ledgerName ?? '').up()
      .ele('ISDEEMEDPOSITIVE').txt(line.amount < 0 ? 'Yes' : 'No').up()
      .ele('AMOUNT').txt(formatAmount(line.amount)).up()
    .up();
  }

  for (const item of mapped.items) {
    doc.ele('ALLINVENTORYENTRIES.LIST')
      .ele('STOCKITEMNAME').txt(item.productName ?? '').up()
      .ele('HSNCODE').txt(item.hsnSacCode ?? '').up()
      .ele('ACTUALQTY').txt(String(item.quantity)).up()
      .ele('BILLEDQTY').txt(String(item.quantity)).up()
      .ele('RATE').txt(formatAmount(item.unitPrice)).up()
      .ele('AMOUNT').txt(formatAmount(item.taxableAmount)).up()
    .up();
  }

  const xml = doc.up().up().up().up().end({ prettyPrint: false });
  return xml;
}

function formatAmount(v) {
  const n = Number(v ?? 0);
  return n.toFixed(2);
}

/**
 * Phase 16 — Tally Connector job payload for a BillIntake (spec Step 12/13).
 *
 * IMPORTANT SCOPE BOUNDARY: Phase 15 deliberately never auto-converts a BillIntake into an official ERP
 * Invoice, and this function does NOT change that. `buildVoucherRequestXml` above requires a fully mapped
 * Invoice (TallyMapper.mapInvoice: customer/product ledger mappings, per-line HSN/quantity/rate, GST
 * computed and frozen by Phase 4's InvoiceCalculationService). A BillIntake has none of that — it is a
 * single vendor-entered total with no authoritative line-item/ledger mapping. Inventing one here would be
 * exactly the "fabricated accounting logic" the spec (Step 13) prohibits.
 *
 * So this function builds ONLY the queue/job payload — the bounded set of already-stored, never-recomputed
 * bill fields the connector needs to attempt a generic single-ledger purchase/journal voucher. It does not
 * build Tally XML (that remains the connector's LocalTallyAdapter responsibility, Side B) and it does not
 * call TallyMapper. See docs/integrations/tally-connector.md "Bill-to-Tally mapping" for exactly what a
 * real implementation still needs (a configured bill-side ledger mapping, which does not exist yet).
 */
export function buildBillJobPayload(bill, integration) {
  return {
    billIntakeId: String(bill._id),
    billNumber: bill.billNumber ?? null,
    billDate: bill.billDate ?? null,
    vendorName: bill.vendorName ?? null,
    vendorGSTIN: bill.vendorGSTIN ?? null,
    amount: bill.amount ?? null,
    taxableAmount: bill.taxableAmount ?? null,
    cgst: bill.cgst ?? null,
    sgst: bill.sgst ?? null,
    igst: bill.igst ?? null,
    // Company identity only — never credentials (spec Step 12: never send Tally credentials in the payload).
    tallyCompanyName: integration?.companyName ?? null,
    // Phase 17: optional configured ledger names for the connector's purchase/journal voucher template
    // (see LocalTallyAdapter.buildVoucherXml). Only fields the tenant has actually configured are included —
    // nothing here is fabricated. An empty object preserves Phase 16's original minimal single-ledger
    // behavior exactly (documented fallback in docs/integrations/tally-connector.md).
    ledgerMapping: buildLedgerMapping(integration),
  };
}

function buildLedgerMapping(integration) {
  const mapping = {};
  for (const key of ['cgstLedger', 'sgstLedger', 'igstLedger', 'roundOffLedger', 'discountLedger']) {
    if (integration?.[key]) mapping[key] = integration[key];
  }
  return mapping;
}
