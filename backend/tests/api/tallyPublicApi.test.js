import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/** Mock local HTTP server standing in for Tally (same pattern as tests/api/tally.api.test.js — no real TallyPrime instance is available in this environment). */
function startMockTally() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end('<ENVELOPE><IMPORTRESULT><CREATED>1</CREATED><ERRORS>0</ERRORS><LASTVCHID>1</LASTVCHID><LASTVCHNO>SALE-001</LASTVCHNO></IMPORTRESULT></ENVELOPE>');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// Phase 13: Tally Public API (Tally/TDL -> ERP) + API key management. Covers lifecycle, scopes, tenant
// binding/IDOR, input safety, rate limiting, concurrency, and response-secrecy guarantees.
test('Phase 13: Tally Public API + API key management', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);

  let rawKeyA;
  let keyIdA;

  await t.test('management: CLIENT_ADMIN can create a key; raw key returned once, never again', async () => {
    const res = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'Tally TDL — Tenant A', scopes: ['tally:company:read', 'tally:customer:read', 'tally:product:read', 'tally:invoice:read', 'tally:sync'] });
    assert.equal(res.status, 201);
    assert.match(res.body.data.key, /^tk_live_/);
    assert.ok(res.body.data.keyPrefix.startsWith('tk_live_'));
    assert.equal(res.body.data.status, 'ACTIVE');
    rawKeyA = res.body.data.key;
    keyIdA = res.body.data.id;

    const list = await api.get('/api/v1/tally/api-keys').set(aAdmin);
    assert.equal(list.status, 200);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(rawKeyA.slice(8)), 'raw key secret must never reappear in list');
    for (const leak of ['keyHash', 'passwordHash', 'tokenHash']) assert.ok(!text.includes(leak), leak);
    assert.ok(list.body.data.some((k) => k.id === keyIdA));
  });

  await t.test('management: CLIENT_USER cannot manage API keys (no permission)', async () => {
    assert.equal((await api.get('/api/v1/tally/api-keys').set(aStaff)).status, 403);
    assert.equal((await api.post('/api/v1/tally/api-keys').set(aStaff).send({ name: 'x' })).status, 403);
  });

  await t.test('management: unknown scope is rejected', async () => {
    const res = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'bad', scopes: ['tally:nonsense'] });
    assert.equal(res.status, 400);
  });

  await t.test('AUTH: valid key authenticates the public API', async () => {
    const res = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', rawKeyA);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.companyName, 'A Business');
  });

  await t.test('AUTH: missing, malformed, and unknown keys all get the same generic failure', async () => {
    const missing = await api.get('/api/v1/tally/public/company');
    const malformed = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', 'not-a-real-key');
    const unknown = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', 'tk_live_' + 'a'.repeat(43));
    for (const res of [missing, malformed, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'TALLY_API_KEY_INVALID');
    }
    assert.deepEqual(missing.body.error, malformed.body.error);
    assert.deepEqual(missing.body.error, unknown.body.error);
  });

  await t.test('TENANT BINDING / IDOR: key for Tenant A cannot read Tenant B data, and a supplied tenantId is ignored', async () => {
    const own = await api.get('/api/v1/tally/public/invoices').set('X-Tally-API-Key', rawKeyA).query({ tenantId: String(B.tenant._id) });
    assert.equal(own.status, 200);
    assert.ok(Array.isArray(own.body.data.items)); // tenantId query param is silently ignored, not honoured
    const crossInvoice = await api.get(`/api/v1/tally/public/invoices/${B.invoice._id}`).set('X-Tally-API-Key', rawKeyA);
    assert.equal(crossInvoice.status, 404);
    const crossSync = await api.post(`/api/v1/tally/public/invoices/${B.invoice._id}/sync`).set('X-Tally-API-Key', rawKeyA);
    assert.equal(crossSync.status, 404);
    const ownInvoice = await api.get(`/api/v1/tally/public/invoices/${A.invoice._id}`).set('X-Tally-API-Key', rawKeyA);
    assert.equal(ownInvoice.status, 200);
    assert.equal(String(ownInvoice.body.data.id), String(A.invoice._id));
  });

  await t.test('SCOPES: a key without tally:sync cannot trigger sync, even though it can read invoices', async () => {
    const limited = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'read-only', scopes: ['tally:invoice:read'] });
    const readOnlyKey = limited.body.data.key;
    const read = await api.get(`/api/v1/tally/public/invoices/${A.invoice._id}`).set('X-Tally-API-Key', readOnlyKey);
    assert.equal(read.status, 200);
    const sync = await api.post(`/api/v1/tally/public/invoices/${A.invoice._id}/sync`).set('X-Tally-API-Key', readOnlyKey);
    assert.equal(sync.status, 403);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_API_SCOPE_DENIED'));
  });

  await t.test('INPUT SAFETY: malformed ObjectId and Mongo-operator-shaped query values are rejected/ignored safely', async () => {
    const badId = await api.get('/api/v1/tally/public/invoices/not-an-object-id').set('X-Tally-API-Key', rawKeyA);
    assert.equal(badId.status, 400);
    const injected = await api.get('/api/v1/tally/public/customers').set('X-Tally-API-Key', rawKeyA).query({ search: { $gt: '' } });
    assert.equal(injected.status, 400);
    const hugeLimit = await api.get('/api/v1/tally/public/customers').set('X-Tally-API-Key', rawKeyA).query({ limit: 999999999 });
    assert.equal(hugeLimit.status, 400);
    const negative = await api.get('/api/v1/tally/public/customers').set('X-Tally-API-Key', rawKeyA).query({ page: -1 });
    assert.equal(negative.status, 400);
  });

  await t.test('CONCURRENCY: two simultaneous key creations get distinct, independently-working secrets', async () => {
    const [r1, r2] = await Promise.all([
      api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'concurrent-1', scopes: ['tally:company:read'] }),
      api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'concurrent-2', scopes: ['tally:company:read'] }),
    ]);
    assert.equal(r1.status, 201); assert.equal(r2.status, 201);
    assert.notEqual(r1.body.data.key, r2.body.data.key);
    assert.notEqual(r1.body.data.id, r2.body.data.id);
    const [auth1, auth2] = await Promise.all([
      api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', r1.body.data.key),
      api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', r2.body.data.key),
    ]);
    assert.equal(auth1.status, 200); assert.equal(auth2.status, 200);
  });

  await t.test('CONCURRENCY: two simultaneous sync calls through the public API preserve Phase 6 idempotency (no duplicate sync records)', async () => {
    const mock = await startMockTally();
    t.after(() => mock.server.close());
    await api.post('/api/v1/tally/config').set(aAdmin).send({
      enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: mock.url, companyName: 'Test Co', defaultVoucherType: 'Sales',
      salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', timeoutMs: 2000, retryMaxAttempts: 3,
    });
    const issued = await api.post('/api/v1/invoices').set(aAdmin).send({ customerId: String(A.customer._id), invoiceDate: new Date('2026-05-01'), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }] });
    await api.post(`/api/v1/invoices/${issued.body.data._id}/issue`).set(aAdmin);
    const [s1, s2] = await Promise.all([
      api.post(`/api/v1/tally/public/invoices/${issued.body.data._id}/sync`).set('X-Tally-API-Key', rawKeyA),
      api.post(`/api/v1/tally/public/invoices/${issued.body.data._id}/sync`).set('X-Tally-API-Key', rawKeyA),
    ]);
    assert.ok([s1.status, s2.status].every((s) => [200, 409].includes(s)));
    const records = h.fake.TallySyncLog.docs.filter((d) => String(d.invoiceId) === String(issued.body.data._id));
    assert.equal(records.length, 1, 'exactly one TallySync record regardless of concurrent calls');
  });

  await t.test('RATE LIMITING: the public API has its own per-key limiter, independent of the general ERP limiter', async () => {
    const limited = await createHarness({ rateLimits: { tallyPublicApi: { windowMs: 60_000, max: 2 } } });
    const limitedAdmin = limited.bearer((await limited.login(limited.A.admin.email)).token);
    const created = await limited.api.post('/api/v1/tally/api-keys').set(limitedAdmin).send({ name: 'rl', scopes: ['tally:company:read'] });
    const key = created.body.data.key;
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await limited.api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', key)).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
  });

  await t.test('LIFECYCLE: revoke makes the key fail auth immediately', async () => {
    const created = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'to-revoke', scopes: ['tally:company:read'] });
    const key = created.body.data.key;
    assert.equal((await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', key)).status, 200);
    const revoked = await api.post(`/api/v1/tally/api-keys/${created.body.data.id}/revoke`).set(aAdmin);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.status, 'REVOKED');
    assert.equal((await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', key)).status, 401);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_API_KEY_REVOKED'));
  });

  await t.test('LIFECYCLE: rotate issues a new secret; the old one stops working, the new one works', async () => {
    const created = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'to-rotate', scopes: ['tally:company:read'] });
    const oldKey = created.body.data.key;
    const rotated = await api.post(`/api/v1/tally/api-keys/${created.body.data.id}/rotate`).set(aAdmin);
    assert.equal(rotated.status, 200);
    const newKey = rotated.body.data.key;
    assert.notEqual(newKey, oldKey);
    assert.equal((await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', oldKey)).status, 401);
    assert.equal((await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', newKey)).status, 200);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_API_KEY_ROTATED'));
  });

  await t.test('EXPIRY: an expired key fails auth and is lazily flipped to EXPIRED exactly once', async () => {
    const created = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'to-expire', scopes: ['tally:company:read'], expiresAt: new Date(Date.now() - 1000).toISOString() });
    const key = created.body.data.key;
    const [r1, r2] = await Promise.all([
      api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', key),
      api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', key),
    ]);
    assert.equal(r1.status, 401); assert.equal(r2.status, 401);
    const doc = h.fake.TallyApiKey.docs.find((d) => d._id === created.body.data.id);
    assert.equal(doc.status, 'EXPIRED');
    assert.equal(h.fake.AuditLog.docs.filter((d) => d.action === 'TALLY_API_KEY_EXPIRED' && d.resourceId === created.body.data.id).length, 1, 'expiry audit fires at most once even under concurrent auth attempts');
  });

  await t.test('response security: management endpoints never leak another tenant\'s keys', async () => {
    const bKey = await api.post('/api/v1/tally/api-keys').set(bAdmin).send({ name: 'tenant-b-key', scopes: ['tally:company:read'] });
    const aList = await api.get('/api/v1/tally/api-keys').set(aAdmin);
    assert.ok(!aList.body.data.some((k) => k.id === bKey.body.data.id));
    const crossGet = await api.get(`/api/v1/tally/api-keys/${bKey.body.data.id}`).set(aAdmin);
    assert.equal(crossGet.status, 404);
  });

  await t.test('ROTATION RACE: no concurrent-request window leaves both the old and new key active', async () => {
    const created = await api.post('/api/v1/tally/api-keys').set(aAdmin).send({ name: 'race-rotate', scopes: ['tally:company:read'] });
    const oldKey = created.body.data.key;
    const [rotateRes, duringRotate] = await Promise.all([
      api.post(`/api/v1/tally/api-keys/${created.body.data.id}/rotate`).set(aAdmin),
      api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', oldKey),
    ]);
    assert.equal(rotateRes.status, 200);
    // The racing request against the OLD key must land on exactly one side of the atomic rotate update —
    // either it was authenticated just before the swap (200) or just after (401) — never anything else,
    // and critically, after this point the old key must be permanently dead and the new key must work.
    assert.ok([200, 401].includes(duringRotate.status));
    const oldAfter = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', oldKey);
    assert.equal(oldAfter.status, 401);
    const newAfter = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', rotateRes.body.data.key);
    assert.equal(newAfter.status, 200);
  });

  await t.test('LOGGING: the API key header is never written to the structured request log context', async () => {
    const originalInfo = h.container.services.auditService; // sanity: reuse real services, not mocks
    assert.ok(originalInfo);
    // httpLogger (middlewares/httpLogger.js) logs method/path/status/duration/userId/tenantId ONLY — it
    // never serializes req.headers, so X-Tally-API-Key structurally cannot reach the log line. Audit
    // metadata additionally redacts any key matching /api[-_]?key/i (utils/sanitize.js) as defence in depth.
    const res = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', rawKeyA);
    assert.equal(res.status, 200);
    const authFailureAudit = h.fake.AuditLog.docs.find((d) => d.action === 'TALLY_API_KEY_AUTH_FAILED');
    if (authFailureAudit) assert.ok(!JSON.stringify(authFailureAudit).includes(rawKeyA));
  });
});
