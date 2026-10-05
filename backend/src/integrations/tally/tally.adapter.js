import { create } from 'xmlbuilder2';
import { IntegrationError } from '../../utils/errors.js';
import { TALLY_ERROR_CODES } from './tally.constants.js';
import { buildVoucherRequestXml } from './tally.payloadBuilder.js';

const PING_XML = create({ version: '1.0' })
  .ele('ENVELOPE').ele('HEADER').ele('TALLYREQUEST').txt('Export Data').end({ prettyPrint: false });

/**
 * Provider abstraction the rest of the app depends on. Concrete XML construction lives in
 * tally.payloadBuilder.js, concrete HTTP/timeout/size-cap handling lives in tally.client.js — this class
 * composes the two so invoice.service.js and the controllers never see either.
 * getCompanies() is intentionally NOT implemented: TallyPrime's XML-over-HTTP interface does not expose a
 * generic "list companies" call without a locally-installed connector/agent (explicitly out of scope —
 * see docs/tally-integration.md). Admins type the company name manually in config instead.
 */
export class TallyAdapter {
  constructor({ client, mapper }) { this.client = client; this.mapper = mapper; }

  /** Lightweight reachability probe: sends Tally's own "Export Data" envelope and expects any well-formed XML back. */
  async testConnection(integration) {
    const start = Date.now();
    try {
      await this.client.send(integration, PING_XML);
      return { connected: true, companyName: integration.companyName, responseTimeMs: Date.now() - start };
    } catch (err) {
      return { connected: false, errorCode: err.code ?? TALLY_ERROR_CODES.UNREACHABLE, message: safeMessage(err) };
    }
  }

  async healthCheck(integration) { return this.testConnection(integration); }

  /** Maps + builds + sends one invoice as a Tally sales voucher. Returns the client's normalized result. */
  async syncInvoice(integration, invoice) {
    const mapped = this.mapper.mapInvoice(integration, invoice);
    const xml = buildVoucherRequestXml(integration, mapped);
    try {
      return await this.client.send(integration, xml);
    } catch (err) {
      if (err instanceof IntegrationError) return { success: false, errorCode: err.code, message: safeMessage(err) };
      throw err;
    }
  }
}

function safeMessage(err) {
  // Never surface raw network error text (hostnames, stack traces, internal paths) — only our own normalized messages.
  if (err instanceof IntegrationError) return err.message;
  return 'Unable to reach the configured Tally endpoint';
}
