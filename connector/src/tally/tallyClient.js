import http from 'node:http';

/**
 * Phase 16 — local TallyPrime transport (Side B). Adapted from, and deliberately kept protocol-compatible
 * with, backend/src/integrations/tally/tally.client.js: the SAME "XML over HTTP" mechanism TallyPrime's
 * ODBC/HTTP gateway exposes (an ENVELOPE/IMPORTDATA POST, an ENVELOPE/IMPORTRESULT response) — spec Step 3
 * and Step 33 require reusing this mechanism rather than inventing a second protocol.
 *
 * This file uses only Node's built-in `http` module (no axios/fast-xml-parser dependency, to keep the
 * connector a zero-dependency, easy-to-distribute executable) and a minimal tag extractor rather than a
 * full XML parser, since the only fields ever read back are the small fixed set TallyPrime documents for
 * IMPORTRESULT. It is NOT a general-purpose XML parser and must not be used for anything else.
 */
function extractTag(xml, tag) {
  const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`, 'i').exec(xml);
  return m ? m[1] : undefined;
}

export class TallyClient {
  constructor({ host, port, timeoutMs = 10_000 }) {
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  /** POSTs a pre-built XML voucher request to TallyPrime and normalizes the response (spec Step 14). */
  send(xmlBody) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: this.host,
        port: this.port,
        method: 'POST',
        path: '/',
        headers: { 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(xmlBody) },
        timeout: this.timeoutMs,
      }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(this.#parse(data));
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('TALLY_TIMEOUT')); });
      req.on('error', (err) => {
        if (err.message === 'TALLY_TIMEOUT') reject(Object.assign(new Error('Connection to Tally timed out'), { code: 'TALLY_TIMEOUT' }));
        else reject(Object.assign(new Error('Could not reach the configured Tally endpoint'), { code: 'TALLY_UNREACHABLE' }));
      });
      req.write(xmlBody);
      req.end();
    });
  }

  #parse(xml) {
    const created = Number(extractTag(xml, 'CREATED') ?? 0);
    const errors = Number(extractTag(xml, 'ERRORS') ?? 0);
    const lastVchId = extractTag(xml, 'LASTVCHID');
    const lastVchNo = extractTag(xml, 'LASTVCHNO');
    const message = extractTag(xml, 'MESSAGE') ?? extractTag(xml, 'LINEERROR');
    if (!xml || !/ENVELOPE/i.test(xml)) {
      return { success: false, errorCode: 'TALLY_INVALID_RESPONSE', message: 'Tally returned an unrecognized response shape' };
    }
    if (errors > 0 || created === 0) {
      const m = (message ?? 'Tally rejected the voucher').toLowerCase();
      let errorCode = 'TALLY_REJECTED';
      if (/company.*(not exist|not found|does not exist)/.test(m)) errorCode = 'TALLY_COMPANY_NOT_FOUND';
      else if (/duplicate|already exists|voucher.*exist/.test(m)) errorCode = 'TALLY_DUPLICATE_VOUCHER';
      return { success: false, errorCode, message: message ?? 'Tally rejected the voucher' };
    }
    return {
      success: true, voucherId: lastVchId, voucherNumber: lastVchNo, message: 'Voucher created',
    };
  }
}
