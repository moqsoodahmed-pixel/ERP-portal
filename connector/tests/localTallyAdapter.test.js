import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LocalTallyAdapter } from '../src/tally/localTallyAdapter.js';

const noopLogger = {
  info() {}, warn() {}, error() {},
};

test('LocalTallyAdapter: mock mode simulates a successful import without any network call', async () => {
  const adapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
  const result = await adapter.submit({ billIntakeId: 'b1', billNumber: 'BILL-1', amount: '100.00' });
  assert.equal(result.success, true);
  assert.match(result.voucherId, /^MOCK-/);
});

test('LocalTallyAdapter: voucher XML is well-formed and escapes special characters (no XML injection)', () => {
  const adapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
  const xml = adapter.buildVoucherXml({
    billNumber: 'BILL-<script>', vendorName: 'A & B "Traders"', vendorGSTIN: '27AAAAA0000A1Z5', amount: '500', billDate: '20260101',
  });
  assert.ok(xml.startsWith('<ENVELOPE>'));
  assert.ok(!xml.includes('<script>'));
  assert.ok(xml.includes('&lt;script&gt;'));
  assert.ok(xml.includes('&amp;'));
  assert.ok(xml.includes('&quot;'));
});

test('LocalTallyAdapter: Phase 17 ledgerMapping posts configured CGST/SGST/IGST lines additively; empty mapping is byte-identical to Phase 16', () => {
  const adapter = new LocalTallyAdapter({ mode: 'mock', companyName: 'Co', logger: noopLogger });
  const basePayload = {
    billNumber: 'BILL-10', vendorName: 'Vendor & Co', vendorGSTIN: '27AAAAA0000A1Z5', amount: '1180.00', billDate: '20260101', cgst: '90.00', sgst: '90.00', igst: '0.00',
  };
  const withoutMapping = adapter.buildVoucherXml(basePayload);
  const withEmptyMapping = adapter.buildVoucherXml({ ...basePayload, ledgerMapping: {} });
  assert.equal(withoutMapping, withEmptyMapping, 'no ledgerMapping and an empty one must produce identical XML (backward compatibility)');
  assert.ok(!withoutMapping.includes('ALLLEDGERENTRIES'));

  const withMapping = adapter.buildVoucherXml({ ...basePayload, ledgerMapping: { cgstLedger: 'CGST & Co', sgstLedger: 'SGST' } });
  assert.ok(withMapping.includes('CGST &amp; Co'), 'configured ledger name is escaped');
  assert.ok(withMapping.includes('<AMOUNT>90.00</AMOUNT>'));
  assert.ok(!withMapping.includes('IGST'), 'igstLedger not configured and igst is 0.00, so no IGST line is emitted');
});

function startMockTally(responseXml) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(responseXml);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

test('LocalTallyAdapter: http mode parses a successful TallyPrime-shaped response', async () => {
  const mock = await startMockTally('<ENVELOPE><IMPORTRESULT><CREATED>1</CREATED><ERRORS>0</ERRORS><LASTVCHID>42</LASTVCHID><LASTVCHNO>PUR-001</LASTVCHNO></IMPORTRESULT></ENVELOPE>');
  try {
    const adapter = new LocalTallyAdapter({
      mode: 'http', host: '127.0.0.1', port: mock.port, companyName: 'Co', timeoutMs: 2000, logger: noopLogger,
    });
    const result = await adapter.submit({ billNumber: 'BILL-2', amount: '200.00' });
    assert.equal(result.success, true);
    assert.equal(result.voucherNumber, 'PUR-001');
  } finally {
    mock.server.close();
  }
});

test('LocalTallyAdapter: http mode classifies a rejected voucher (company not found)', async () => {
  const mock = await startMockTally('<ENVELOPE><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><MESSAGE>Company does not exist</MESSAGE></IMPORTRESULT></ENVELOPE>');
  try {
    const adapter = new LocalTallyAdapter({
      mode: 'http', host: '127.0.0.1', port: mock.port, companyName: 'Co', timeoutMs: 2000, logger: noopLogger,
    });
    const result = await adapter.submit({ billNumber: 'BILL-3', amount: '200.00' });
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'TALLY_COMPANY_NOT_FOUND');
  } finally {
    mock.server.close();
  }
});

test('LocalTallyAdapter: http mode reports TALLY_UNREACHABLE when nothing is listening', async () => {
  const adapter = new LocalTallyAdapter({
    mode: 'http', host: '127.0.0.1', port: 1, companyName: 'Co', timeoutMs: 1000, logger: noopLogger,
  });
  const result = await adapter.submit({ billNumber: 'BILL-4', amount: '1.00' });
  assert.equal(result.success, false);
  assert.ok(['TALLY_UNREACHABLE', 'TALLY_TIMEOUT'].includes(result.errorCode));
});
