import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { IntegrationError } from '../../utils/errors.js';
import { TALLY_ERROR_CODES, TALLY_NETWORK_DEFAULTS } from './tally.constants.js';
import { assertSafeTallyUrl, clampTimeout } from './tally.ssrf.js';

const parser = new XMLParser({ ignoreAttributes: false });

/**
 * Tally's XML protocol has no structured error-code field on a rejected IMPORTRESULT — only a free-text
 * MESSAGE. These patterns match the phrasing TallyPrime is documented to use for the two most common,
 * actionable rejection reasons so the caller (and the ERP's own UI/audit trail) gets a specific code
 * instead of a generic "rejected" for cases worth distinguishing. Anything that doesn't match either
 * pattern still falls back to the generic REJECTED code — this is a best-effort classification, not a
 * guarantee (never verified against a real TallyPrime instance; see docs/tally-integration.md).
 */
function classifyRejection(message) {
  const m = message.toLowerCase();
  if (/company.*(not exist|not found|does not exist)/.test(m)) return TALLY_ERROR_CODES.COMPANY_NOT_FOUND;
  // Phase 17 (unverified against real Tally — see tally.constants.js comment above). Checked BEFORE the
  // generic duplicate-voucher pattern below: "voucher type does not exist" would otherwise also match the
  // looser "voucher.*exist" duplicate phrasing, so the more specific ledger/voucher-type/busy checks must
  // win first.
  if (/ledger.*(not exist|not found|does not exist)/.test(m)) return TALLY_ERROR_CODES.INVALID_LEDGER;
  if (/voucher type.*(not exist|not found|does not exist)/.test(m)) return TALLY_ERROR_CODES.INVALID_VOUCHER_TYPE;
  if (/please wait|busy|another.*in progress|try again/.test(m)) return TALLY_ERROR_CODES.BUSY;
  if (/duplicate|already exists|voucher.*exist/.test(m)) return TALLY_ERROR_CODES.DUPLICATE_VOUCHER;
  return TALLY_ERROR_CODES.REJECTED;
}

/**
 * HTTP/XML transport to a Tally instance (TallyPrime's "XML over HTTP" interface, typically on port
 * 9000 of the machine running Tally). Every call: validates the URL against the SSRF policy, enforces a
 * finite timeout, caps the response body size, and never leaks a raw network error (ECONNREFUSED stack,
 * DNS failure text, etc.) to the caller — everything is normalized to a `{success:false, errorCode,
 * message}` shape or an IntegrationError with a TALLY_* code.
 */
export class TallyClient {
  async send(integration, xmlBody) {
    const xmlText = await this.#post(integration, xmlBody);
    return this.#parseResponse(xmlText);
  }

  /**
   * Phase 20 — read path: POSTs a "Voucher Register" export request (same XML-over-HTTP transport as
   * `send()` above, same SSRF/timeout/size guards) and parses back a list of vouchers instead of an
   * IMPORTRESULT acknowledgement. NOTE: TallyPrime's exact export XML schema for this report has not been
   * verified against a real TallyPrime instance in this environment (same documented caveat as the
   * IMPORTRESULT rejection-message classification in classifyRejection() above — see
   * docs/tally-integration.md "NOT AVAILABLE"); the shape parsed here (`ENVELOPE.VOUCHER[]` with
   * DATE/VOUCHERNUMBER/PARTYNAME/NARRATION/AMOUNT) follows Tally's documented "Day Book"-style voucher
   * collection export.
   */
  async fetchVouchers(integration, xmlBody) {
    const xmlText = await this.#post(integration, xmlBody);
    return this.#parseVoucherList(xmlText);
  }

  async #post(integration, xmlBody) {
    const url = await assertSafeTallyUrl(integration.baseUrl);
    const timeout = clampTimeout(integration.timeoutMs);
    const maxBytes = TALLY_NETWORK_DEFAULTS.maxResponseBytes;

    let response;
    try {
      response = await axios.post(url.toString(), xmlBody, {
        timeout,
        maxContentLength: maxBytes,
        maxBodyLength: maxBytes,
        responseType: 'text',
        headers: { 'Content-Type': 'text/xml' },
        auth: integration.authUsername ? { username: integration.authUsername, password: integration.authPasswordPlain ?? '' } : undefined,
        validateStatus: () => true,
      });
    } catch (err) {
      if (err.code === 'ECONNABORTED' || /timeout/i.test(err.message ?? '')) {
        throw new IntegrationError('Connection to Tally timed out', TALLY_ERROR_CODES.TIMEOUT, 504);
      }
      if (axios.isAxiosError(err) && err.response === undefined && /maxContentLength|maxBodyLength/i.test(err.message ?? '')) {
        throw new IntegrationError('Tally response exceeded the allowed size', TALLY_ERROR_CODES.RESPONSE_TOO_LARGE, 502);
      }
      throw new IntegrationError('Could not reach the configured Tally endpoint', TALLY_ERROR_CODES.UNREACHABLE, 502);
    }

    const bodyLength = Buffer.byteLength(String(response.data ?? ''), 'utf8');
    if (bodyLength > maxBytes) {
      throw new IntegrationError('Tally response exceeded the allowed size', TALLY_ERROR_CODES.RESPONSE_TOO_LARGE, 502);
    }
    if (response.status >= 400) {
      throw new IntegrationError(`Tally endpoint returned HTTP ${response.status}`, TALLY_ERROR_CODES.REJECTED, 502);
    }
    return response.data;
  }

  #parseVoucherList(xmlText) {
    let parsed;
    try {
      parsed = parser.parse(String(xmlText ?? ''));
    } catch {
      throw new IntegrationError('Tally returned a response that could not be parsed', TALLY_ERROR_CODES.MALFORMED_RESPONSE, 502);
    }
    const envelope = parsed?.ENVELOPE;
    if (envelope === undefined || envelope === null) {
      throw new IntegrationError('Tally returned an unrecognized response shape', TALLY_ERROR_CODES.MALFORMED_RESPONSE, 502);
    }
    // An empty <ENVELOPE></ENVELOPE> (zero vouchers — a valid, non-error result) parses to '' rather than
    // {}, since fast-xml-parser represents a childless element as an empty string; only a non-object,
    // non-empty-string value is an actually-unrecognized shape.
    if (typeof envelope !== 'object' && envelope !== '') {
      throw new IntegrationError('Tally returned an unrecognized response shape', TALLY_ERROR_CODES.MALFORMED_RESPONSE, 502);
    }
    const raw = typeof envelope === 'object' ? envelope.VOUCHER : undefined;
    const list = raw === undefined || raw === null || raw === '' ? [] : (Array.isArray(raw) ? raw : [raw]);
    return list.map((v) => ({
      voucherNumber: v?.VOUCHERNUMBER !== undefined ? String(v.VOUCHERNUMBER) : undefined,
      date: v?.DATE !== undefined ? String(v.DATE) : undefined,
      party: v?.PARTYNAME !== undefined ? String(v.PARTYNAME) : undefined,
      narration: v?.NARRATION !== undefined ? String(v.NARRATION) : undefined,
      amount: v?.AMOUNT !== undefined ? String(v.AMOUNT) : undefined,
    }));
  }

  #parseResponse(xmlText) {
    let parsed;
    try {
      parsed = parser.parse(String(xmlText ?? ''));
    } catch {
      throw new IntegrationError('Tally returned a response that could not be parsed', TALLY_ERROR_CODES.MALFORMED_RESPONSE, 502);
    }
    const envelope = parsed?.ENVELOPE ?? parsed?.RESPONSE ?? null;
    if (!envelope) throw new IntegrationError('Tally returned an unrecognized response shape', TALLY_ERROR_CODES.MALFORMED_RESPONSE, 502);

    const created = Number(envelope.IMPORTRESULT?.CREATED ?? envelope.CREATED ?? 0);
    const errorCount = Number(envelope.IMPORTRESULT?.ERRORS ?? envelope.ERRORS ?? 0);
    const lastVoucherId = envelope.IMPORTRESULT?.LASTVCHID ?? envelope.LASTVCHID;
    const voucherNumber = envelope.IMPORTRESULT?.LASTVCHNO ?? envelope.LASTVCHNO;

    if (errorCount > 0 || created === 0) {
      const message = String(envelope.IMPORTRESULT?.MESSAGE ?? envelope.LINEERROR ?? 'Tally rejected the voucher');
      return { success: false, errorCode: classifyRejection(message), message };
    }
    return {
      success: true,
      voucherId: lastVoucherId ? String(lastVoucherId) : undefined,
      voucherNumber: voucherNumber ? String(voucherNumber) : undefined,
      message: 'Voucher created',
    };
  }
}
