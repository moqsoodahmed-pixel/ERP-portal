import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/**
 * Starts a MOCK local HTTP server standing in for a Tally instance — this is NOT a real TallyPrime
 * instance (none is available in this environment; see docs/tally-integration.md "NOT AVAILABLE").
 * `mode` controls its canned response and can be changed between requests.
 */
function startMockTally() {
  const state = { mode: 'success', calls: 0 };
  const server = http.createServer((req, res) => {
    state.calls += 1;
    if (state.mode === 'slow') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(successXml()); }, 3000);
      return;
    }
    if (state.mode === 'malformed') {
      res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<<not-xml-at-all>>>'); return;
    }
    if (state.mode === 'oversized') {
      res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end('<ENVELOPE>' + 'A'.repeat(3 * 1024 * 1024) + '</ENVELOPE>'); return;
    }
    if (state.mode === 'rejected') {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      const msg = state.rejectMessage ?? 'Ledger does not exist';
      res.end(`<ENVELOPE><IMPORTRESULT><CREATED>0</CREATED><ERRORS>1</ERRORS><MESSAGE>${msg}</MESSAGE></IMPORTRESULT></ENVELOPE>`);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(successXml());
  });
  function successXml() {
    return '<ENVELOPE><IMPORTRESULT><CREATED>1</CREATED><ERRORS>0</ERRORS><LASTVCHID>555</LASTVCHID><LASTVCHNO>SALE-001</LASTVCHNO></IMPORTRESULT></ENVELOPE>';
  }
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const baseConfig = (baseUrl) => ({
  enabled: true, connectionType: 'LOCAL_TALLY', baseUrl, companyName: 'Test Co', defaultVoucherType: 'Sales',
  salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', timeoutMs: 2000, retryMaxAttempts: 3,
});

test('Tally integration: config, SSRF, sync eligibility, idempotency, payload, RBAC', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const admin = h.bearer((await h.login(A.admin.email)).token);
  const staff = h.bearer((await h.login(A.staff.email)).token);
  const adminB = h.bearer((await h.login(B.admin.email)).token);
  const mock = await startMockTally();
  t.after(() => mock.server.close());

  await t.test('config CRUD by CLIENT_ADMIN, masked secrets', async () => {
    const created = await api.post('/api/v1/tally/config').set(admin).send({ ...baseConfig(mock.url), authPassword: 'Sup3rSecret!' });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.hasPassword, true);
    assert.equal(created.body.data.authPasswordEncrypted, undefined);
    assert.equal(JSON.stringify(created.body.data).includes('Sup3rSecret'), false);

    const read = await api.get('/api/v1/tally/config').set(admin);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.baseUrl, mock.url);
    assert.equal(read.body.data.hasPassword, true);
    assert.equal(read.body.data.authPasswordEncrypted, undefined);
  });

  await t.test('unauthorized roles are rejected', async () => {
    assert.equal((await api.post('/api/v1/tally/config').set(staff).send(baseConfig(mock.url))).status, 403);
    const vendorLogin = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.equal((await api.get('/api/v1/tally/config').set(vendorLogin)).status, 403);
  });

  await t.test('tenant isolation: tenant B sees no config, cannot read tenant A config', async () => {
    const readB = await api.get('/api/v1/tally/config').set(adminB);
    assert.equal(readB.status, 200);
    assert.equal(readB.body.data.status, 'NOT_CONFIGURED');
  });

  await t.test('SSRF: metadata IP is rejected', async () => {
    const res = await api.post('/api/v1/tally/config').set(admin).send(baseConfig('http://169.254.169.254/'));
    assert.equal(res.status, 400);
  });

  await t.test('SSRF: non-http(s) protocol is rejected', async () => {
    const res = await api.post('/api/v1/tally/config').set(admin).send(baseConfig('file:///etc/passwd'));
    assert.equal(res.status, 400);
  });

  await t.test('SSRF: private/LAN address (127.0.0.1) is ALLOWED (realistic on-prem Tally)', async () => {
    const res = await api.post('/api/v1/tally/config').set(admin).send(baseConfig(mock.url));
    assert.equal(res.status, 200);
  });

  await t.test('test-connection: success against the mock server', async () => {
    mock.state.mode = 'success';
    const res = await api.post('/api/v1/tally/test-connection').set(admin).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, true);
    assert.ok(typeof res.body.data.responseTimeMs === 'number');
    const read = await api.get('/api/v1/tally/config').set(admin);
    assert.equal(read.body.data.lastConnectionStatus, 'SUCCESS');
  });

  await t.test('test-connection: unreachable endpoint returns a normalized error, not a raw network error', async () => {
    await api.post('/api/v1/tally/config').set(admin).send(baseConfig('http://127.0.0.1:1'));
    const res = await api.post('/api/v1/tally/test-connection').set(admin).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, false);
    assert.ok(res.body.data.errorCode);
    assert.equal(/ECONNREFUSED|errno|at Object/i.test(res.body.data.message ?? ''), false);
    await api.post('/api/v1/tally/config').set(admin).send(baseConfig(mock.url));
  });

  await t.test('test-connection: timeout is enforced against a slow/hanging mock endpoint', async () => {
    await api.post('/api/v1/tally/config').set(admin).send({ ...baseConfig(mock.url), timeoutMs: 1000 });
    mock.state.mode = 'slow';
    const res = await api.post('/api/v1/tally/test-connection').set(admin).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, false);
    mock.state.mode = 'success';
    await api.post('/api/v1/tally/config').set(admin).send({ ...baseConfig(mock.url), timeoutMs: 5000 });
  });

  await t.test('test-connection: malformed XML response is normalized, not a crash', async () => {
    mock.state.mode = 'malformed';
    const res = await api.post('/api/v1/tally/test-connection').set(admin).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, false);
    mock.state.mode = 'success';
  });

  await t.test('test-connection: oversized response is capped/rejected', async () => {
    mock.state.mode = 'oversized';
    const res = await api.post('/api/v1/tally/test-connection').set(admin).send();
    assert.equal(res.status, 200);
    assert.equal(res.body.data.connected, false);
    mock.state.mode = 'success';
  });

  await t.test('sync eligibility: DRAFT rejected, CANCELLED-unsynced rejected, ISSUED eligible', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '2' }],
    })).body.data;
    const draftSync = await api.post(`/api/v1/invoices/${draft._id}/tally-sync`).set(admin).send();
    assert.equal(draftSync.status, 409);
    assert.equal(draftSync.body.error.code, 'TALLY_INVOICE_NOT_ISSUED');

    const cancelled = (await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({ reason: 'test' })).body.data;
    const cancelledSync = await api.post(`/api/v1/invoices/${cancelled._id}/tally-sync`).set(admin).send();
    assert.equal(cancelledSync.status, 409);
    assert.equal(cancelledSync.body.error.code, 'TALLY_INVOICE_NOT_ISSUED');

    const issuedDraft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '2' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${issuedDraft._id}/issue`).set(admin).send()).body.data;
    const okSync = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(okSync.status, 200);
    assert.equal(okSync.body.data.status, 'SYNCED');
    assert.equal(okSync.body.data.voucherNumber, 'SALE-001');
  });

  await t.test('idempotency: sync x3 results in exactly one actual Tally call, stable SYNCED, no duplicate records', async () => {
    mock.state.calls = 0;
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;

    const first = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(first.body.data.status, 'SYNCED');
    const second = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(second.body.data.status, 'SYNCED');
    const third = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(third.body.data.status, 'SYNCED');
    assert.equal(mock.state.calls, 1, 'only the first request should have actually called Tally');

    const status = await api.get(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin);
    assert.equal(status.body.data.status, 'SYNCED');
  });

  await t.test('failure handling: Tally rejection produces a clean FAILED status, never a 500', async () => {
    mock.state.mode = 'rejected';
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    const res = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(res.status, 200);
    assert.ok(['FAILED', 'RETRYING'].includes(res.body.data.status));
    assert.ok(res.body.data.errorMessage);
    mock.state.mode = 'success';

    // Retry: with a successful mock, the invoice becomes SYNCED without a new record being required.
    const retry = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.status, 'SYNCED');
  });

  await t.test('Phase 17: extended error classification (invalid ledger / invalid voucher type / busy) — inferred, unverified against real Tally', async () => {
    const makeIssued = async () => {
      const draft = (await api.post('/api/v1/invoices').set(admin).send({
        customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
      })).body.data;
      return (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    };
    const cases = [
      ['Ledger does not exist', 'TALLY_INVALID_LEDGER'],
      ['Voucher Type does not exist', 'TALLY_INVALID_VOUCHER_TYPE'],
      ['Tally is busy, please wait', 'TALLY_BUSY'],
    ];
    for (const [message, code] of cases) {
      mock.state.mode = 'rejected';
      mock.state.rejectMessage = message;
      const issued = await makeIssued();
      const res = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
      assert.equal(res.status, 200);
      assert.equal(res.body.data.errorCode, code, `message "${message}" should classify as ${code}`);
    }
    mock.state.mode = 'success';
    mock.state.rejectMessage = undefined;
  });

  await t.test('failure handling: disabled integration and missing config produce clean normalized errors', async () => {
    await api.post('/api/v1/tally/config').set(admin).send({ ...baseConfig(mock.url), enabled: false });
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    const disabled = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(admin).send();
    assert.equal(disabled.status, 409);
    assert.equal(disabled.body.error.code, 'TALLY_DISABLED');

    const fresh = await h.mkTenant('NOTALLY');
    const freshAdmin = h.bearer((await h.login(fresh.admin.email)).token);
    const notConfigured = await api.post(`/api/v1/invoices/${fresh.invoice._id}/issue`).set(freshAdmin).send().then(() => api.post(`/api/v1/invoices/${fresh.invoice._id}/tally-sync`).set(freshAdmin).send());
    assert.equal(notConfigured.status, 409);
    assert.equal(notConfigured.body.error.code, 'TALLY_NOT_CONFIGURED');
    await api.post('/api/v1/tally/config').set(admin).send({ ...baseConfig(mock.url), enabled: true });
  });

  await t.test('payload correctness: known CGST+SGST (intra-state) scenario carries authoritative totals', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '10' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    assert.ok(Number(issued.cgst) > 0 && Number(issued.sgst) > 0 && Number(issued.igst) === 0, 'intra-state: CGST+SGST, no IGST');

    const { TallyMapper } = await import('../../src/integrations/tally/tally.mapper.js');
    const config = await api.get('/api/v1/tally/config').set(admin);
    const mapper = new TallyMapper();
    const mapped = mapper.mapInvoice(config.body.data, issued);
    assert.equal(mapped.grandTotal, issued.grandTotal);
    assert.equal(mapped.cgst, issued.cgst);
    assert.equal(mapped.sgst, issued.sgst);
    assert.equal(mapped.invoiceNumber, issued.invoiceNumber);
    assert.equal(mapped.buyerGstin, issued.customerSnapshot.gstin);
    assert.equal(mapped.items[0].hsnSacCode, issued.items[0].hsnSacCode);
  });

  await t.test('payload correctness: known IGST (inter-state) scenario', async () => {
    const interCustomer = (await api.post('/api/v1/customers').set(admin).send({ name: 'Inter State Co', billingAddress: { state: 'Other State', stateCode: '09' } })).body.data;
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(interCustomer._id), invoiceDate: '2026-04-05', gstApplicable: true, interState: true, items: [{ productId: String(A.product._id), quantity: '4' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    assert.ok(Number(issued.igst) > 0 && Number(issued.cgst) === 0 && Number(issued.sgst) === 0, 'inter-state: IGST only');
  });

  await t.test('historical integrity: payload still reflects the frozen snapshot after live records change', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    const originalName = issued.customerSnapshot.name;
    const originalProductName = issued.items[0].productName;

    await api.patch(`/api/v1/customers/${A.customer._id}`).set(admin).send({ name: 'Renamed After Issue' });
    await api.patch(`/api/v1/products/${A.product._id}`).set(admin).send({ productName: 'Renamed Product After Issue' });

    const refetched = (await api.get(`/api/v1/invoices/${issued._id}`).set(admin)).body.data;
    const { TallyMapper } = await import('../../src/integrations/tally/tally.mapper.js');
    const config = await api.get('/api/v1/tally/config').set(admin);
    const mapped = new TallyMapper().mapInvoice(config.body.data, refetched);
    assert.equal(mapped.buyerName, originalName, 'mapper still reflects the ORIGINAL frozen customer name');
    assert.equal(mapped.items[0].productName, originalProductName, 'mapper still reflects the ORIGINAL frozen product name');
  });

  await t.test('RBAC: tally.sync is grantable to CLIENT_USER independently of tally.configure', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send({
      customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }],
    })).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    const denied = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(staff).send();
    assert.equal(denied.status, 403);
    await api.patch(`/api/v1/users/${A.staff._id}`).set(admin).send({ grantedPermissions: ['products.view', 'customers.view', 'invoices.view', 'tally.view', 'tally.sync'] });
    const staffToken = h.bearer((await h.login(A.staff.email)).token);
    const allowed = await api.post(`/api/v1/invoices/${issued._id}/tally-sync`).set(staffToken).send();
    assert.equal(allowed.status, 200);
    // tally.configure was NOT granted: config access still denied.
    assert.equal((await api.post('/api/v1/tally/config').set(staffToken).send(baseConfig(mock.url))).status, 403);
  });

  await t.test('GST_VENDOR: read-only tally-sync status for an actively-assigned tenant, never config/test-connection, never another tenant', async () => {
    const vendorLogin = h.bearer((await h.login(h.vendorUser.email)).token);
    // Config and connection-test stay out of reach regardless of assignment.
    assert.equal((await api.get('/api/v1/tally/config').set(vendorLogin)).status, 403);
    assert.equal((await api.post('/api/v1/tally/config').set(vendorLogin).send(baseConfig(mock.url))).status, 403);
    assert.equal((await api.post('/api/v1/tally/test-connection').set(vendorLogin).send()).status, 403);
    // h.vendorUser is actively assigned to A.tenant -> read-only sync status allowed, sync trigger still denied.
    assert.equal((await api.get(`/api/v1/invoices/${A.invoice._id}/tally-sync`).set(vendorLogin)).status, 200);
    assert.equal((await api.post(`/api/v1/invoices/${A.invoice._id}/tally-sync`).set(vendorLogin).send()).status, 403);
    // h.vendorUser has no assignment to B.tenant -> denied even though the invoice id is otherwise valid.
    assert.ok([403, 404].includes((await api.get(`/api/v1/invoices/${B.invoice._id}/tally-sync`).set(vendorLogin)).status));
  });

  await t.test('tenant isolation: cross-tenant sync/status access rejected', async () => {
    const other = await api.post(`/api/v1/invoices/${B.invoice._id}/tally-sync`).set(admin).send();
    assert.ok([403, 404].includes(other.status));
    const otherStatus = await api.get(`/api/v1/invoices/${B.invoice._id}/tally-sync`).set(admin);
    assert.ok([403, 404].includes(otherStatus.status));
  });

  await t.test('malformed ObjectId on tally-sync routes returns 400, not 500', async () => {
    assert.equal((await api.post('/api/v1/invoices/not-an-object-id/tally-sync').set(admin).send()).status, 400);
    assert.equal((await api.get('/api/v1/invoices/not-an-object-id/tally-sync').set(admin)).status, 400);
  });
});
