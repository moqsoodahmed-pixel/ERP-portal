import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * Runs against a REAL MongoDB: set MONGODB_TEST_URI (CI service container / docker compose) or allow
 * mongodb-memory-server to download a binary. Otherwise the suite is SKIPPED with an explicit reason.
 */
let uri = process.env.MONGODB_TEST_URI;
let memory;
let skipReason;
if (!uri) {
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memory = await MongoMemoryServer.create();
    uri = memory.getUri();
  } catch (err) {
    skipReason = `No MongoDB available (set MONGODB_TEST_URI). Reason: ${String(err.message).split('\n')[0].slice(0, 120)}`;
  }
}

test('real MongoDB: indexes, atomic counters, decimals, tenant isolation, append-only audit', { skip: skipReason }, async (t) => {
  const { models } = await import('../../src/models/index.js');
  const { buildContainer } = await import('../../src/container.js');
  const { createApp } = await import('../../src/app.js');
  const { hashPassword } = await import('../../src/security/password.js');

  await mongoose.connect(uri, { dbName: `erp_it_${Date.now()}` });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await memory?.stop(); });
  await Promise.all(Object.values(models).map((m) => m.syncIndexes()));

  const container = buildContainer(models);
  const { repos, services } = container;
  const api = request(createApp(container));
  const passwordHash = await hashPassword('Dev-Only-Pass-123');
  const mk = async (code) => {
    const tenant = await repos.tenants.create({ tenantCode: code, businessName: code, status: 'ACTIVE' });
    const admin = await repos.users.createUnscoped({ tenantId: tenant._id, name: code, email: `${code.toLowerCase()}@example.test`, passwordHash, role: 'CLIENT_ADMIN', status: 'ACTIVE' });
    return { tenant, admin };
  };
  const A = await mk('TNT-A'); const B = await mk('TNT-B');
  const ctxOf = (x) => ({ tenantId: String(x.tenant._id), actor: { id: String(x.admin._id), role: 'CLIENT_ADMIN' }, permissions: new Set(), requestId: 'it' });

  await t.test('atomic counters yield unique codes under concurrency', async () => {
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) => services.productService.create(ctxOf(A), { productName: `P${i}`, sellingPrice: '10.00' })));
    assert.equal(new Set(created.map((p) => p.productCode)).size, 10);
  });

  await t.test('unique (tenantId, productCode) is enforced by MongoDB; same code allowed in another tenant', async () => {
    await assert.rejects(() => models.Product.create({ tenantId: A.tenant._id, productCode: 'PROD-000001', productName: 'dup', sellingPrice: '1' }), (e) => e.code === 11000);
    await models.Product.create({ tenantId: B.tenant._id, productCode: 'PROD-000001', productName: 'ok in B', sellingPrice: '1' });
  });

  await t.test('cross-tenant reads/updates are impossible through repositories', async () => {
    const bProd = await models.Product.findOne({ tenantId: B.tenant._id }).lean();
    assert.equal(await repos.products.findOneById(A.tenant._id, bProd._id), null);
    assert.equal(await repos.products.updateById(A.tenant._id, bProd._id, { productName: 'x' }), null);
  });

  await t.test('end-to-end over HTTP: login, create invoice with Decimal128 money, read back as exact strings', async () => {
    const login = await api.post('/api/v1/auth/login').send({ email: A.admin.email, password: 'Dev-Only-Pass-123' });
    assert.equal(login.status, 200);
    const h = { Authorization: `Bearer ${login.body.data.accessToken}` };
    await api.post('/api/v1/business-profile').set(h).send({ displayName: 'TNT-A Business', address: { state: 'Demo', stateCode: '27' } });
    const customer = (await api.post('/api/v1/customers').set(h).send({ name: 'Cust' })).body.data;
    const product = (await api.post('/api/v1/products').set(h).send({ productName: 'Item', sellingPrice: '0.10', gstRate: 18, isGstApplicable: true })).body.data;
    const inv = await api.post('/api/v1/invoices').set(h).send({ customerId: customer._id, invoiceDate: '2026-04-01', gstApplicable: true, items: [{ productId: product._id, quantity: '3' }] });
    assert.equal(inv.status, 201);
    assert.equal(inv.body.data.subtotal, '0.30'); assert.equal(inv.body.data.grandTotal, '0.35');
    const read = await api.get(`/api/v1/invoices/${inv.body.data._id}`).set(h);
    assert.equal(read.body.data.items[0].quantity, '3');
    assert.ok(!JSON.stringify(read.body).includes('passwordHash'));
  });

  await t.test('audit logs are append-only in MongoDB', async () => {
    assert.ok(await models.AuditLog.countDocuments() > 0);
    await assert.rejects(() => models.AuditLog.updateMany({}, { $set: { action: 'LOGIN' } }), /Append-only/);
  });
});
