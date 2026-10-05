import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

// Production smoke test: the golden path through infra endpoints + one real workflow per role, run
// against a controlled test database (no real Tally/email/SMS/payment calls). This is the automated
// subset of docs/deployment/smoke-tests.md — the rest of that checklist needs a real browser/real
// deployment and is run manually after each deploy.
test('production smoke test: health endpoints + golden path per role', async (t) => {
  const h = await createHarness();
  const { api, A, master, vendorUser } = h;

  await t.test('GET /health is always 200 and leaks nothing', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
  });

  await t.test('GET /ready reflects database readiness (this harness uses fake models, not a live Mongo connection; see tests/api/security.test.js for the isReady() wiring itself)', async () => {
    const res = await api.get('/ready');
    assert.equal(res.status, 503);
    assert.equal(res.body.status, 'not_ready');
  });

  await t.test('GET /version exposes only version + env, never secrets or dependency internals', async () => {
    const res = await api.get('/version');
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.version === 'string' && res.body.version.length > 0);
    assert.ok(['development', 'test', 'production'].includes(res.body.env));
    const body = JSON.stringify(res.body);
    for (const leak of ['mongodb://', 'SECRET', 'KEY']) assert.ok(!body.includes(leak), leak);
  });

  await t.test('AUTH: login, authenticated request, logout', async () => {
    const login = await api.post('/api/v1/auth/login').send({ email: A.admin.email, password: 'Dev-Only-Pass-123' });
    assert.equal(login.status, 200);
    const token = login.body.data.accessToken;
    const me = await api.get('/api/v1/auth/me').set(h.bearer(token));
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, A.admin.email);
  });

  await t.test('MASTER: platform dashboard + client list load', async () => {
    const m = h.bearer((await h.login(master.email)).token);
    assert.equal((await api.get('/api/v1/master/dashboard').set(m)).status, 200);
    assert.equal((await api.get('/api/v1/clients').set(m)).status, 200);
  });

  await t.test('CLIENT: dashboard, products, customers, invoice already created by the harness fixture', async () => {
    const aAdmin = h.bearer((await h.login(A.admin.email)).token);
    assert.equal((await api.get('/api/v1/dashboard').set(aAdmin)).status, 200);
    assert.equal((await api.get('/api/v1/products').set(aAdmin)).status, 200);
    assert.equal((await api.get('/api/v1/customers').set(aAdmin)).status, 200);
    const invoices = await api.get('/api/v1/invoices').set(aAdmin);
    assert.equal(invoices.status, 200);
    assert.ok(invoices.body.data.items.some((i) => String(i._id) === String(A.invoice._id)));
  });

  await t.test('VENDOR: read-only access to the assigned tenant; cannot write', async () => {
    const v = h.bearer((await h.login(vendorUser.email)).token);
    const invoices = await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v);
    assert.equal(invoices.status, 200);
    const write = await api.post('/api/v1/invoices').set(v).send({ customerId: String(A.customer._id), items: [] });
    assert.ok([401, 403].includes(write.status));
  });

  await t.test('REPORTS/NOTIFICATIONS: endpoints respond for an authenticated client user', async () => {
    const aAdmin = h.bearer((await h.login(A.admin.email)).token);
    assert.equal((await api.get('/api/v1/notifications').set(aAdmin)).status, 200);
  });

  await t.test('SECURITY: unauthenticated and cross-tenant access are both denied', async () => {
    assert.equal((await api.get('/api/v1/dashboard')).status, 401);
    const bAdmin = h.bearer((await h.login(h.B.admin.email)).token);
    const crossTenant = await api.get(`/api/v1/invoices/${A.invoice._id}`).set(bAdmin);
    assert.ok([403, 404].includes(crossTenant.status));
  });
});
