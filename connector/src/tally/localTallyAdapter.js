import { TallyClient } from './tallyClient.js';

/**
 * Phase 16 — LocalTallyAdapter (Side B). The ONLY thing the connector is ever allowed to do with a job: run
 * exactly the SYNC_BILL_TO_TALLY flow against a controlled, generated voucher XML — never arbitrary
 * XML/commands received from the cloud (spec Step 14/22). The cloud sends only bounded bill DATA
 * (buildBillJobPayload on the ERP side); this adapter is what turns that data into Tally XML, entirely
 * locally, using the same fixed template every time.
 *
 * Two modes:
 *  - 'mock' (default): no real TallyPrime instance is reachable in this environment. Simulates a
 *    successful import without any network call, so the connector and its job-loop can be fully exercised
 *    and tested end-to-end. ALWAYS clearly logged/reported as mock, never claimed as a real sync.
 *  - 'http': sends the generated XML to a real local TallyPrime instance via TallyClient (same protocol as
 *    backend/src/integrations/tally/tally.client.js). This path has NOT been validated against a real
 *    TallyPrime/TDL instance in this environment — see docs/integrations/tally-connector.md.
 */
export class LocalTallyAdapter {
  constructor({ mode, host, port, companyName, timeoutMs, logger }) {
    this.mode = mode;
    this.companyName = companyName;
    this.logger = logger;
    this.client = mode === 'http' ? new TallyClient({ host, port, timeoutMs }) : null;
  }

  /** Builds a minimal, fixed-shape "Purchase"/journal voucher XML from the job payload. No GST recomputation —
   * all amounts are used exactly as received, already frozen on the bill/ERP side.
   *
   * Phase 17: if the ERP sent a non-empty `payload.ledgerMapping` (only populated when the tenant has
   * actually configured ledger names — see tally.payloadBuilder.js#buildLedgerMapping), additional
   * ALLLEDGERENTRIES.LIST lines are emitted for the bill's already-computed CGST/SGST/IGST amounts against
   * those configured ledger names. This is purely additive: when ledgerMapping is empty/absent (the
   * Phase 16 default — nothing configured), the XML shape is byte-for-byte identical to before, which is
   * the documented backward-compatible fallback. No ledger name is ever invented here. */
  buildVoucherXml(payload) {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const amount = Number(payload.amount ?? 0).toFixed(2);
    const mapping = payload.ledgerMapping ?? {};
    const extraLines = [];
    const addLine = (ledgerName, value) => {
      const n = Number(value ?? 0);
      if (ledgerName && n > 0) {
        extraLines.push(
          '<ALLLEDGERENTRIES.LIST>',
          `<LEDGERNAME>${esc(ledgerName)}</LEDGERNAME>`,
          '<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>',
          `<AMOUNT>${n.toFixed(2)}</AMOUNT>`,
          '</ALLLEDGERENTRIES.LIST>',
        );
      }
    };
    addLine(mapping.cgstLedger, payload.cgst);
    addLine(mapping.sgstLedger, payload.sgst);
    addLine(mapping.igstLedger, payload.igst);
    return [
      '<ENVELOPE>',
      '<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>',
      '<BODY><IMPORTDATA><REQUESTDESC>',
      '<REPORTNAME>Vouchers</REPORTNAME>',
      `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(payload.tallyCompanyName ?? this.companyName)}</SVCURRENTCOMPANY></STATICVARIABLES>`,
      '</REQUESTDESC><REQUESTDATA>',
      '<TALLYMESSAGE><VOUCHER VCHTYPE="Purchase" ACTION="Create">',
      `<DATE>${esc(payload.billDate)}</DATE>`,
      `<VOUCHERNUMBER>${esc(payload.billNumber)}</VOUCHERNUMBER>`,
      `<PARTYLEDGERNAME>${esc(payload.vendorName)}</PARTYLEDGERNAME>`,
      `<PARTYGSTIN>${esc(payload.vendorGSTIN)}</PARTYGSTIN>`,
      `<AMOUNT>${amount}</AMOUNT>`,
      ...extraLines,
      '</VOUCHER></TALLYMESSAGE>',
      '</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>',
    ].join('');
  }

  /** Returns a normalized { success, voucherId?, voucherNumber?, errorCode?, message } result — never throws for an expected Tally-side rejection. */
  async submit(payload) {
    if (this.mode === 'mock') {
      this.logger?.warn('Submitting to MOCK Tally adapter — no real TallyPrime instance is used', { billIntakeId: payload.billIntakeId });
      return {
        success: true, voucherId: `MOCK-${payload.billIntakeId}`, voucherNumber: payload.billNumber ?? 'MOCK-VCH', message: 'Mock Tally import succeeded (no real TallyPrime instance was contacted)',
      };
    }
    const xml = this.buildVoucherXml(payload);
    try {
      return await this.client.send(xml);
    } catch (err) {
      return { success: false, errorCode: err.code ?? 'TALLY_UNREACHABLE', message: err.message };
    }
  }
}
