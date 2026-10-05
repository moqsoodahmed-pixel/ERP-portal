import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { buildPhase9Fixtures, EXPECTED, aprilQuery } from '../helpers/phase9Fixtures.js';

/**
 * Phase 9 against a REAL MongoDB (same skip rules as mongo.test.js). The fake harness emulates aggregation;
 * this suite proves the actual pipelines behave identically on MongoDB: Decimal128 $sum, ObjectId casting in
 * $match/$lookup (Mongoose does not cast aggregate pipelines), the notification dedup unique index, and that
 * report queries use the existing Phase 4 (tenantId, invoiceDate) index.
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

test('real MongoDB: Phase 9 dashboards, reports, CSV and notifications', { skip: skipReason }, async (t) => {
  const { models } = await import('../../src/models/index.js');
  const { buildContainer } = await import('../../src/container.js');
  const { createApp } = await import('../../src/app.js');
  const { hashPassword } = await import('../../src/security/password.js');

  await mongoose.connect(uri, { dbName: `erp_p9_${Date.now()}` });
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await memory?.stop(); });
  await Promise.all(Object.values(models).map((mdl) => mdl.syncIndexes()));

  const container = buildContainer(models);
  const { repos, services } = container;
  const api = request(createApp(container));
  const PASSWORD = 'Dev-Only-Pass-123';
  const passwordHash = await hashPassword(PASSWORD);

  // Same shape as the fake harness tenants, so the shared hand-computed fixtures apply unchanged.
  const mkTenant = async (name) => {
    const tenant = await repos.tenants.create({ tenantCode: `T-${name}`, businessName: `Business ${name}`, status: 'ACTIVE' });
    const admin = await repos.users.createUnscoped({ tenantId: tenant._id, name: `${name} admin`, email: `admin.${name.toLowerCase()}@example.test`, passwordHash, role: 'CLIENT_ADMIN', status: 'ACTIVE' });
    const ctx = { tenantId: String(tenant._id), actor: { id: String(admin._id), role: 'CLIENT_ADMIN' }, permissions: new Set(), ip: '127.0.0.1', requestId: 'it' };
    await services.businessProfileService.create(ctx, { displayName: `${name} Business`, address: { state: 'Demo', stateCode: '27' } });
    const product = await services.productService.create(ctx, { productName: `${name} Widget`, sellingPrice: '100.00', gstRate: 18, isGstApplicable: true });
    const customer = await services.customerService.create(ctx, { name: `${name} Customer`, billingAddress: { state: 'Demo', stateCode: '27' } });
    const invoice = await services.invoiceService.create(ctx, { customerId: String(customer._id), invoiceDate: new Date('2026-04-01'), gstApplicable: true, items: [{ productId: String(product._id), quantity: '2' }] });
    return { tenant, admin, ctx, product, customer, invoice };
  };
  const A = await mkTenant('A');
  const B = await mkTenant('B');
  const fx = await buildPhase9Fixtures({ services, repos, A, B });
  const login = async (email) => ({ Authorization: `Bearer ${(await api.post('/api/v1/auth/login').send({ email, password: PASSWORD })).body.data.accessToken}` });
  const aAdmin = await login(A.admin.email);
  const bAdmin = await login(B.admin.email);

  await t.test('client dashboard aggregation on MongoDB equals hand-computed values (Decimal128 sums)', async () => {
    const res = await api.get(`/api/v1/dashboard?${aprilQuery}`).set(aAdmin);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.data.invoices.byStatus, EXPECTED.aprilByStatus);
    assert.deepEqual(res.body.data.invoices.issued, EXPECTED.aprilIssued);
    const { total, synced, failed, pending } = res.body.data.tally;
    assert.deepEqual({ total, synced, failed, pending }, EXPECTED.aprilTally, '$lookup on ObjectId invoiceId');
    const b = (await api.get(`/api/v1/dashboard?${aprilQuery}`).set(bAdmin)).body.data;
    assert.equal(b.invoices.issued.grandTotal, EXPECTED.bAprilIssued.grandTotal);
  });

  await t.test('invoice-summary + gst-summary + customer-summary on MongoDB', async () => {
    const inv = (await api.get(`/api/v1/reports/invoice-summary?${aprilQuery}&limit=2`).set(aAdmin)).body.data;
    assert.deepEqual(inv.summary.totals, EXPECTED.aprilAllTotals);
    assert.equal(inv.pagination.total, 5);
    const gst = (await api.get('/api/v1/reports/gst-summary?range=custom&from=2026-04-01&to=2026-05-31').set(aAdmin)).body.data;
    assert.deepEqual(gst.items.map(({ _id, ...r }) => r), EXPECTED.gstAprMay.rows);
    assert.deepEqual(gst.summary.totals, EXPECTED.gstAprMay.totals);
    const cust = (await api.get('/api/v1/reports/customer-summary').set(aAdmin)).body.data;
    const row = cust.items.find((c) => c._id === String(A.customer._id));
    assert.equal(row.issuedInvoiceCount, EXPECTED.customerIssued.count);
    assert.equal(row.issuedGrandTotal, EXPECTED.customerIssued.grandTotal);
    assert.equal(cust.summary.createdByMonth.length, 1);
  });

  await t.test('filing status readiness via aggregation on MongoDB', async () => {
    const filing = await repos.gstFilings.create(A.tenant._id, { periodKey: '2026-04', returnType: 'GSTR_1', status: 'IN_PROGRESS', milestones: [] }, A.admin._id);
    await repos.gstFilingIssues.create(A.tenant._id, { filingId: String(filing._id), type: 'OTHER', severity: 'CRITICAL', title: 'x', status: 'OPEN', raisedBy: A.admin._id });
    const row = (await api.get('/api/v1/reports/gst-filing-status').set(aAdmin)).body.data.items[0];
    assert.equal(row.openIssues, 1);
    assert.ok(row.readiness.blockers.includes('2 issued invoice(s) not Tally-synced'));
    assert.ok(row.readiness.blockers.includes('1 open critical issue(s)'));
  });

  await t.test('CSV export streams from MongoDB and is audited', async () => {
    const res = await api.get(`/api/v1/reports/invoice-summary/export?${aprilQuery}`).set(aAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.text.trim().split('\r\n').length, 1 + 5);
    assert.ok(await models.AuditLog.countDocuments({ action: 'DATA_EXPORT', tenantId: A.tenant._id }) >= 1);
  });

  await t.test('notifications: generated on MongoDB; unique (recipientUserId, dedupKey) index blocks duplicates', async () => {
    // inv1, inv2, inv4 (later cancelled), inv5, inv6 were issued in tenant A.
    assert.equal(await models.Notification.countDocuments({ recipientUserId: A.admin._id, type: 'INVOICE_ISSUED' }), 5);
    assert.equal(await models.Notification.countDocuments({ recipientUserId: A.admin._id, type: 'INVOICE_CANCELLED' }), 1);
    const issued = await repos.invoices.findOneById(A.tenant._id, fx.inv2._id);
    assert.equal(await services.notificationService.invoiceIssued(issued), 0, 're-fired event is a no-op');
    await assert.rejects(
      () => models.Notification.create({ tenantId: A.tenant._id, recipientUserId: A.admin._id, type: 'INVOICE_ISSUED', title: 'dup', dedupKey: `INVOICE_ISSUED:${fx.inv2._id}` }),
      (e) => e.code === 11000,
    );
    assert.equal(await models.Notification.countDocuments({ recipientUserId: B.admin._id, tenantId: A.tenant._id }), 0);
  });

  await t.test('notification API on MongoDB: ownership, IDOR, concurrent mark-read', async () => {
    const list = (await api.get('/api/v1/notifications?limit=50').set(aAdmin)).body.data;
    assert.equal(list.pagination.total, 6);
    const bNote = (await api.get('/api/v1/notifications?limit=1').set(bAdmin)).body.data.items[0];
    assert.equal((await api.patch(`/api/v1/notifications/${bNote._id}/read`).set(aAdmin)).status, 404);
    assert.equal((await models.Notification.findById(bNote._id).lean()).isRead, false);
    const target = list.items[0]._id;
    const results = await Promise.all([1, 2, 3].map(() => api.patch(`/api/v1/notifications/${target}/read`).set(aAdmin)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(new Set(results.map((r) => r.body.data.readAt)).size, 1, 'atomic isRead:false precondition: readAt set exactly once');
    assert.equal((await api.get('/api/v1/notifications/unread-count').set(aAdmin)).body.data.unread, 5);
  });

  await t.test('indexes: notification indexes exist; tenant/date report $match uses an index (no COLLSCAN)', async () => {
    const names = (await models.Notification.collection.indexes()).map((i) => JSON.stringify(i.key));
    for (const k of [{ recipientUserId: 1, createdAt: -1 }, { recipientUserId: 1, isRead: 1, createdAt: -1 }, { tenantId: 1, createdAt: -1 }, { recipientUserId: 1, dedupKey: 1 }]) {
      assert.ok(names.includes(JSON.stringify(k)), JSON.stringify(k));
    }
    const plan = JSON.stringify(await models.Invoice.aggregate([
      { $match: { tenantId: new mongoose.Types.ObjectId(String(A.tenant._id)), isDeleted: { $ne: true }, invoiceDate: { $gte: new Date('2026-04-01'), $lte: new Date('2026-04-30T23:59:59.999Z') } } },
      { $group: { _id: null, n: { $sum: 1 } } },
    ]).explain());
    assert.ok(plan.includes('IXSCAN'), 'index scan used');
    assert.ok(!plan.includes('COLLSCAN'), 'no collection scan');
  });
});
