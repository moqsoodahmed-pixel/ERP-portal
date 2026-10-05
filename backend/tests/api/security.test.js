import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHarness, PASSWORD } from '../helpers/harness.js';
import { createApp } from '../../src/app.js';

test('HTTP hardening', async (t) => {
  const h = await createHarness();
  const { api, A } = h;

  await t.test('security headers present; no x-powered-by; request ids echoed or generated', async () => {
    const res = await api.get('/health');
    assert.equal(res.status, 200); assert.equal(res.body.status, 'ok');
    assert.equal(res.headers['x-powered-by'], undefined);
    assert.ok(res.headers['x-content-type-options']); assert.ok(res.headers['content-security-policy']); assert.ok(res.headers['strict-transport-security']);
    assert.ok(res.headers['x-request-id']);
    assert.equal((await api.get('/health').set('X-Request-Id', 'client-req-12345678')).headers['x-request-id'], 'client-req-12345678');
    assert.notEqual((await api.get('/health').set('X-Request-Id', 'bad id with spaces!')).headers['x-request-id'], 'bad id with spaces!');
  });

  await t.test('readiness reflects dependency state without leaking details', async () => {
    const down = request(createApp(h.container, { isReady: () => false }));
    const res = await down.get('/ready');
    assert.equal(res.status, 503); assert.deepEqual(res.body, { status: 'not_ready' });
    assert.equal((await request(createApp(h.container, { isReady: () => true })).get('/ready')).status, 200);
  });

  await t.test('error envelope is consistent; 404, malformed JSON, oversized body', async () => {
    const nf = await api.get('/api/v1/nope');
    assert.deepEqual(Object.keys(nf.body).sort(), ['error', 'requestId', 'success']);
    assert.equal(nf.body.error.code, 'NOT_FOUND');
    const bad = await api.post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email": ');
    assert.equal(bad.status, 400); assert.equal(bad.body.error.message, 'Malformed JSON body');
    const big = await api.post('/api/v1/auth/login').send({ email: 'a@example.test', password: 'x'.repeat(200_000) });
    assert.equal(big.status, 413); assert.equal(big.body.error.code, 'PAYLOAD_TOO_LARGE');
    const v = await api.post('/api/v1/auth/login').send({ email: 'not-an-email', password: 'x' });
    assert.equal(v.body.error.code, 'VALIDATION_ERROR'); assert.ok(Array.isArray(v.body.error.details));
  });

  await t.test('unexpected server errors return a generic 500 and never leak internals', async () => {
    const original = h.container.repos.users.findByEmailWithSecret;
    h.container.repos.users.findByEmailWithSecret = () => { throw new Error('secret-internal-detail at /srv/app/db.js'); };
    const res = await api.post('/api/v1/auth/login').send({ email: A.admin.email, password: PASSWORD });
    h.container.repos.users.findByEmailWithSecret = original;
    assert.equal(res.status, 500); assert.equal(res.body.error.code, 'INTERNAL_ERROR');
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes('secret-internal-detail') && !text.includes('/srv/app') && !text.includes('stack'));
    assert.ok(res.body.requestId);
  });

  await t.test('operator injection in query/body is neutralised', async () => {
    const { token } = await h.login(A.admin.email);
    const res = await api.get('/api/v1/products?search[$ne]=x&status[$gt]=').set(h.bearer(token));
    assert.ok([200, 400].includes(res.status));
    const idRes = await api.get('/api/v1/products/%7B%22%24ne%22%3Anull%7D').set(h.bearer(token));
    assert.equal(idRes.status, 400);
    const post = await api.post('/api/v1/customers').set(h.bearer(token)).send({ name: { $ne: 'x' } });
    assert.equal(post.status, 400);
    const dotted = await api.post('/api/v1/customers').set(h.bearer(token)).send({ name: 'ok', 'a.b': 1 });
    assert.equal(dotted.status, 201);
    assert.equal(h.fake.Customer.docs.at(-1)['a.b'], undefined);
  });

  await t.test('sensitive data is never exposed by any list/get endpoint', async () => {
    const m = h.bearer((await h.login(h.master.email)).token);
    const ad = h.bearer((await h.login(A.admin.email)).token);
    const bodies = [
      (await api.get('/api/v1/users').set(ad)).body, (await api.get('/api/v1/auth/me').set(ad)).body,
      (await api.get('/api/v1/vendors').set(m)).body, (await api.get('/api/v1/clients').set(m)).body, (await api.get('/api/v1/audit-logs').set(m)).body,
    ];
    const text = JSON.stringify(bodies);
    for (const s of ['passwordHash', 'tokenHash', 'credentialsEncrypted', '$2a$', '$2b$', PASSWORD, 'JWT_ACCESS_SECRET']) assert.ok(!text.includes(s), s);
  });

  await t.test('rate limiting: login limiter returns 429 with the standard envelope and records a security event', async () => {
    const limited = await createHarness({ rateLimits: { login: { windowMs: 60_000, max: 3 } } });
    const codes = [];
    for (let i = 0; i < 5; i += 1) codes.push((await limited.api.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'Wrong-Password-1' })).status);
    assert.deepEqual(codes, [401, 401, 401, 429, 429]);
    const res = await limited.api.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'Wrong-Password-1' });
    assert.equal(res.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(limited.fake.SecurityEvent.docs.some((e) => e.type === 'RATE_LIMIT_TRIGGERED'));
  });

  await t.test('OpenAPI document and Swagger UI load; placeholders are marked', async () => {
    const spec = await api.get('/api/v1/openapi.json');
    assert.equal(spec.status, 200); assert.equal(spec.body.openapi, '3.0.3');
    for (const p of ['/auth/login', '/clients', '/products', '/customers', '/invoices', '/vendors', '/gst/filings', '/tally/sync', '/audit-logs', '/users']) assert.ok(spec.body.paths[p], p);
    assert.match(spec.body.paths['/tally/sync'].post.summary, /PLACEHOLDER/);
    const ui = await api.get('/api/docs/');
    assert.equal(ui.status, 200); assert.match(ui.text, /swagger/i);
  });
});
