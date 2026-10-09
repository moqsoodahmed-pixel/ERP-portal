import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/**
 * Mock local HTTP server standing in for a Tally instance's voucher-export response — NOT a real
 * TallyPrime instance (none available in this environment; same caveat as tests/api/tally.api.test.js).
 * `state.vouchers` controls the canned voucher list returned for every request.
 */
function startMockTallyVouchers() {
  const state = { mode: 'success', vouchers: [], calls: 0 };
  const server = http.createServer((req, res) => {
    state.calls += 1;
    if (state.mode === 'slow') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(voucherXml()); }, 3000);
      return;
    }
    if (state.mode === 'malformed') {
      res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<<not-xml-at-all>>>'); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(voucherXml());
  });
  function voucherXml() {
    const items = state.vouchers.map((v) => `<VOUCHER><DATE>${v.date ?? '20260101'}</DATE><VOUCHERNUMBER>${v.voucherNumber}</VOUCHERNUMBER><PARTYNAME>${v.party ?? 'Cash'}</PARTYNAME><NARRATION>${v.narration}</NARRATION><AMOUNT>${v.amount}</AMOUNT></VOUCHER>`).join('');
    return `<ENVELOPE>${items}</ENVELOPE>`;
  }
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const baseConfig = (baseUrl, extra = {}) => ({
  enabled: true, connectionType: 'LOCAL_TALLY', baseUrl, companyName: 'Test Co', defaultVoucherType: 'Sales',
  salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', timeoutMs: 2000, retryMaxAttempts: 3,
  authPassword: 'Sup3rSecretTallyPass!', ...extra,
});

test('Phase 20: GST Bill <-> Tally bill-by-bill matching', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(h.vendorUser.email)).token);
  const mock = await startMockTallyVouchers();
  t.after(() => mock.server.close());

  const { formatCode } = await import('../../src/utils/codes.js');
  const { ID_PREFIX } = await import('../../src/constants/pagination.js');
  const { hashPassword } = await import('../../src/security/password.js');
  const vendor2Code = formatCode(ID_PREFIX.vendor, await h.repos.counters.next(null, 'vendor'));
  const vendor2 = await h.repos.vendors.create({ vendorCode: vendor2Code, name: 'Vendor Two', status: 'ACTIVE' });
  const vendor2User = await h.repos.users.createUnscoped({
    vendorId: vendor2._id, name: 'Vendor Two User', email: 'mvendor2@example.test', passwordHash: await hashPassword('Dev-Only-Pass-123'), role: 'GST_VENDOR', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0,
  });
  const v2 = h.bearer((await h.login(vendor2User.email)).token);

  const makeFilingWithBill = async (periodKey, items) => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey, returnType: 'GSTR_1' });
    assert.equal(filingRes.status, 201);
    const filing = filingRes.body.data;
    const billRes = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items });
    assert.equal(billRes.status, 200);
    return { filing, bill: billRes.body.data };
  };

  await t.test('setup: tenant A configures Tally against the mock server', async () => {
    const res = await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'CONFIGURED');
  });

  await t.test('CRITICAL: 10 client bills + 10 matching Tally bills => 10/10 FULLY_MATCHED', async () => {
    mock.state.mode = 'success';
    const items = Array.from({ length: 10 }, (_, i) => ({ productName: `Product ${i + 1}`, rate: String(1000 + i * 100) }));
    mock.state.vouchers = items.map((it, i) => ({ voucherNumber: `TALLY-${1001 + i}`, narration: it.productName, amount: it.rate }));
    const { filing } = await makeFilingWithBill('2029-01', items);

    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    const result = res.body.data;
    assert.equal(result.totalClientBills, 10);
    assert.equal(result.totalTallyBills, 10);
    assert.equal(result.matchedCount, 10);
    assert.equal(result.unmatchedCount, 0);
    assert.equal(result.extraTallyCount, 0);
    assert.equal(result.overallStatus, 'FULLY_MATCHED');
    assert.ok(result.results.every((r) => r.status === 'MATCHED'));

    const getRes = await api.get(`/api/v1/gst-filings/${filing._id}/tally-matching`).set(v);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.data.overallStatus, 'FULLY_MATCHED');
  });

  await t.test('10 client bills + 9 matching => PARTIAL_MATCH, never FULLY_MATCHED', async () => {
    mock.state.mode = 'success';
    const items = Array.from({ length: 10 }, (_, i) => ({ productName: `Nine ${i + 1}`, rate: String(2000 + i * 50) }));
    // Voucher for item #5 has a mismatched amount -> MISMATCH, not MATCHED.
    mock.state.vouchers = items.map((it, i) => ({
      voucherNumber: `TALLY-N-${i}`, narration: it.productName, amount: i === 4 ? String(Number(it.rate) + 1) : it.rate,
    }));
    const { filing } = await makeFilingWithBill('2029-02', items);

    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.matchedCount, 9);
    assert.equal(res.body.data.unmatchedCount, 1);
    assert.equal(res.body.data.overallStatus, 'PARTIAL_MATCH');
    assert.notEqual(res.body.data.overallStatus, 'FULLY_MATCHED');
    const mismatched = res.body.data.results.find((r) => r.productName === 'Nine 5');
    assert.equal(mismatched.status, 'MISMATCH');
    assert.equal(mismatched.reason, 'Bill total does not match Tally total.');
  });

  await t.test('1 client bill + 1 matching Tally bill = MATCHED, FULLY_MATCHED overall', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Solo Consulting', rate: '4999.50' }];
    mock.state.vouchers = [{ voucherNumber: 'TALLY-SOLO', narration: 'Solo Consulting', amount: '4999.50' }];
    const { filing } = await makeFilingWithBill('2029-03', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.overallStatus, 'FULLY_MATCHED');
    assert.equal(res.body.data.results[0].status, 'MATCHED');
    assert.equal(res.body.data.results[0].tallyVoucherNumber, 'TALLY-SOLO');
  });

  await t.test('missing Tally bill => NOT_FOUND', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Never In Tally', rate: '100' }];
    mock.state.vouchers = [];
    const { filing } = await makeFilingWithBill('2029-04', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.results[0].status, 'NOT_FOUND');
    assert.equal(res.body.data.results[0].reason, 'No corresponding Tally bill found.');
    assert.equal(res.body.data.overallStatus, 'NOT_MATCHED');
  });

  await t.test('duplicate Tally candidates => DUPLICATE, never an arbitrary pick', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Ambiguous Item', rate: '750' }];
    mock.state.vouchers = [
      { voucherNumber: 'TALLY-D1', narration: 'Ambiguous Item', amount: '750' },
      { voucherNumber: 'TALLY-D2', narration: 'Ambiguous Item', amount: '750' },
    ];
    const { filing } = await makeFilingWithBill('2029-05', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.results[0].status, 'DUPLICATE');
    assert.equal(res.body.data.results[0].tallyVoucherNumber, null);
  });

  await t.test('extra Tally bill is reported and blocks FULLY_MATCHED even when every client bill matches', async () => {
    mock.state.mode = 'success';
    const items = [
      { productName: 'Extra Test A', rate: '111' },
      { productName: 'Extra Test B', rate: '222' },
    ];
    mock.state.vouchers = [
      { voucherNumber: 'T-A', narration: 'Extra Test A', amount: '111' },
      { voucherNumber: 'T-B', narration: 'Extra Test B', amount: '222' },
      { voucherNumber: 'T-EXTRA', narration: 'Unrelated Voucher', amount: '999' },
    ];
    const { filing } = await makeFilingWithBill('2029-06', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.matchedCount, 2);
    assert.equal(res.body.data.totalTallyBills, 3);
    assert.equal(res.body.data.extraTallyCount, 1);
    assert.notEqual(res.body.data.overallStatus, 'FULLY_MATCHED');
    assert.equal(res.body.data.overallStatus, 'PARTIAL_MATCH');
  });

  await t.test('Tally connection failure returns a controlled TALLY_ERROR, never a 500, never a false mismatch', async () => {
    await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig('http://127.0.0.1:1'));
    const items = [{ productName: 'Unreachable Test', rate: '50' }];
    const { filing } = await makeFilingWithBill('2029-07', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.overallStatus, 'TALLY_ERROR');
    assert.equal(res.body.data.results[0].status, 'ERROR');
    assert.notEqual(res.body.data.results[0].status, 'MISMATCH');
    assert.ok(/retrieve Tally data/i.test(res.body.data.errorMessage ?? ''));
    await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));
    mock.state.mode = 'success';
  });

  await t.test('missing Tally company mapping is rejected with a controlled configuration error', async () => {
    await api.post('/api/v1/tally/config').set(aAdmin).send({ ...baseConfig(mock.url), companyName: '' });
    const items = [{ productName: 'No Company Mapping', rate: '10' }];
    const { filing } = await makeFilingWithBill('2029-08', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.overallStatus, 'TALLY_ERROR');
    assert.match(res.body.data.errorMessage, /company mapping is missing/i);
    await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));
  });

  await t.test('running matching twice is idempotent: same document updated in place, never duplicated', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Idempotent Item', rate: '300' }];
    mock.state.vouchers = [{ voucherNumber: 'T-IDEMP', narration: 'Idempotent Item', amount: '300' }];
    const { filing } = await makeFilingWithBill('2029-09', items);
    const first = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    const second = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(first.body.data._id, second.body.data._id);
    assert.equal(mock.state.calls > 0, true);
  });

  await t.test('client bill (items/subtotal/GST/total) is unchanged after a MISMATCH result', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Untouched Bill', rate: '10000' }];
    mock.state.vouchers = [{ voucherNumber: 'T-DIFF', narration: 'Untouched Bill', amount: '10500' }];
    const { filing, bill: before } = await makeFilingWithBill('2029-10', items);
    await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    const after = await api.get(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin);
    assert.equal(after.body.data.items[0].rate, before.items[0].rate);
    assert.equal(after.body.data.subtotal, before.subtotal);
    assert.equal(after.body.data.gstAmount, before.gstAmount);
    assert.equal(after.body.data.grandTotal, before.grandTotal);
  });

  await t.test('frontend-submitted overallStatus/matchedCount are never trusted: backend always recomputes', async () => {
    mock.state.mode = 'success';
    const items = [
      { productName: 'Trust Test A', rate: '10' },
      { productName: 'Trust Test B', rate: '20' },
    ];
    // Only one voucher provided for two items -> the real computed result must be PARTIAL_MATCH/NOT_MATCHED,
    // regardless of what the (ignored) request body claims.
    mock.state.vouchers = [{ voucherNumber: 'T-TRUST', narration: 'Trust Test A', amount: '10' }];
    const { filing } = await makeFilingWithBill('2029-11', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send({
      overallStatus: 'FULLY_MATCHED', matchedCount: 999, totalClientBills: 1, results: [],
    });
    assert.equal(res.status, 200);
    assert.notEqual(res.body.data.overallStatus, 'FULLY_MATCHED');
    assert.equal(res.body.data.matchedCount, 1);
    assert.equal(res.body.data.totalClientBills, 2);
  });

  await t.test('Tally credentials never appear in the matching API response', async () => {
    mock.state.mode = 'success';
    const items = [{ productName: 'Secret Check', rate: '15' }];
    mock.state.vouchers = [{ voucherNumber: 'T-SEC', narration: 'Secret Check', amount: '15' }];
    const { filing } = await makeFilingWithBill('2029-12', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    const dump = JSON.stringify(res.body);
    assert.equal(dump.includes('Sup3rSecretTallyPass'), false);
    assert.equal(dump.includes('authPasswordEncrypted'), false);
    assert.equal(dump.includes('authPasswordPlain'), false);
  });

  await t.test('RBAC: CLIENT_ADMIN cannot run matching (view-only permission does not include match)', async () => {
    const items = [{ productName: 'Client Cannot Run', rate: '5' }];
    const { filing } = await makeFilingWithBill('2030-01', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(aAdmin).send();
    assert.equal(res.status, 403);
  });

  await t.test('RBAC/isolation: an unassigned vendor cannot run matching, cannot view the result, cannot access tenant B', async () => {
    const items = [{ productName: 'Unassigned Vendor Test', rate: '5' }];
    const { filing } = await makeFilingWithBill('2030-02', items);
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v2).send()).status, 403);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/tally-matching`).set(v2)).status, 403);

    const bFilingRes = await api.post('/api/v1/gst-filings').set(bAdmin).send({ periodKey: '2030-02', returnType: 'GSTR_1' });
    await api.put(`/api/v1/gst-filings/${bFilingRes.body.data._id}/bill`).set(bAdmin).send({ items: [{ productName: 'B Bill', rate: '5' }] });
    assert.equal((await api.post(`/api/v1/gst-filings/${bFilingRes.body.data._id}/tally-matching/run`).set(v).send()).status, 403);
  });

  await t.test('unauthenticated matching requests are rejected', async () => {
    const items = [{ productName: 'Unauth Test', rate: '5' }];
    const { filing } = await makeFilingWithBill('2030-03', items);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/tally-matching`)).status, 401);
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).send()).status, 401);
  });

  await t.test('malformed Tally XML response is normalized to TALLY_ERROR, never a crash', async () => {
    await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));
    mock.state.mode = 'malformed';
    const items = [{ productName: 'Malformed Test', rate: '5' }];
    const { filing } = await makeFilingWithBill('2030-04', items);
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.overallStatus, 'TALLY_ERROR');
    mock.state.mode = 'success';
  });

  await t.test('viewing a matching result that was never run returns 404', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2030-05', returnType: 'GSTR_1' });
    const res = await api.get(`/api/v1/gst-filings/${filingRes.body.data._id}/tally-matching`).set(v);
    assert.equal(res.status, 404);
  });
});
