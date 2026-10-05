import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, PASSWORD } from '../helpers/harness.js';

test('RBAC', async (t) => {
  const h = await createHarness();
  const { api, A } = h;
  const admin = h.bearer((await h.login(A.admin.email)).token);
  const staff = h.bearer((await h.login(A.staff.email)).token);
  const master = h.bearer((await h.login(h.master.email)).token);
  const vendor = h.bearer((await h.login(h.vendorUser.email)).token);

  await t.test('CLIENT_USER default is read-only', async () => {
    assert.equal((await api.get('/api/v1/products').set(staff)).status, 200);
    assert.equal((await api.post('/api/v1/products').set(staff).send({ productName: 'x', sellingPrice: '1' })).status, 403);
    assert.equal((await api.delete(`/api/v1/products/${A.product._id}`).set(staff)).status, 403);
    assert.equal((await api.post('/api/v1/customers').set(staff).send({ name: 'x' })).status, 403);
    assert.equal((await api.get('/api/v1/users').set(staff)).status, 403);
    assert.ok(h.fake.SecurityEvent.docs.some((e) => e.type === 'UNAUTHORIZED_ACCESS'));
  });

  await t.test('permissions are configurable per user, not only per role', async () => {
    const res = await api.post('/api/v1/users').set(admin).send({ name: 'Cashier', email: 'cashier@example.test', password: PASSWORD, grantedPermissions: ['products.create', 'invoices.create'] });
    assert.equal(res.status, 201);
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    const cashier = h.bearer((await h.login('cashier@example.test')).token);
    assert.equal((await api.post('/api/v1/products').set(cashier).send({ productName: 'Allowed', sellingPrice: '5' })).status, 201);
    assert.equal((await api.delete(`/api/v1/products/${A.product._id}`).set(cashier)).status, 403);
    const me = await api.get('/api/v1/auth/me').set(cashier);
    assert.ok(me.body.data.permissions.includes('products.create'));
  });

  await t.test('platform permissions cannot be granted to tenant users; privilege escalation is blocked', async () => {
    const bad = await api.post('/api/v1/users').set(admin).send({ name: 'X', email: 'x1@example.test', password: PASSWORD, grantedPermissions: ['clients.create'] });
    assert.equal(bad.status, 400);
    const esc = await api.post('/api/v1/users').set(admin).send({ name: 'X', email: 'x2@example.test', password: PASSWORD, role: 'CLIENT_ADMIN' });
    assert.equal(esc.status, 403);
    const dup = await api.post('/api/v1/users').set(admin).send({ name: 'X', email: A.staff.email, password: PASSWORD });
    assert.equal(dup.status, 409);
  });

  await t.test('a user cannot grant permissions they do not hold', async () => {
    await api.post('/api/v1/users').set(admin).send({ name: 'Mgr', email: 'mgr@example.test', password: PASSWORD, grantedPermissions: ['users.create', 'users.view'] });
    const mgr = h.bearer((await h.login('mgr@example.test')).token);
    const res = await api.post('/api/v1/users').set(mgr).send({ name: 'Y', email: 'y@example.test', password: PASSWORD, grantedPermissions: ['invoices.delete'] });
    assert.equal(res.status, 403);
  });

  await t.test('vendors cannot create invoices or manage platform resources', async () => {
    assert.equal((await api.post('/api/v1/invoices').set(vendor).send({})).status, 403);
    assert.equal((await api.post('/api/v1/vendors').set(vendor).send({})).status, 403);
    assert.equal((await api.get('/api/v1/gst/filings').set(vendor)).status, 501);
  });

  await t.test('Master Admin can manage clients; creating a client with its admin is audited and works end-to-end', async () => {
    const res = await api.post('/api/v1/clients').set(master).send({ businessName: 'New Co', admin: { name: 'New Admin', email: 'newadmin@example.test', password: PASSWORD } });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.tenant.tenantCode, 'TNT-000001');
    assert.ok(!JSON.stringify(res.body).includes('passwordHash'));
    assert.equal(res.body.data.adminUser.status, 'PENDING');
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'CLIENT_ADMIN_CREATED'));

    // Client Admin is created PENDING and cannot log in until Master Admin activates the account.
    assert.equal((await h.login('newadmin@example.test').catch((e) => e)) instanceof Error, true);
    const id = res.body.data.tenant._id;
    const userId = res.body.data.adminUser.id;
    const activate = await api.patch(`/api/v1/users/${userId}`).set(master).set('X-Admin-Tenant-Id', id).send({ status: 'ACTIVE' });
    assert.equal(activate.status, 200);
    const newAdmin = h.bearer((await h.login('newadmin@example.test')).token);
    const products = await api.get('/api/v1/products').set(newAdmin);
    assert.equal(products.status, 200); assert.equal(products.body.data.items.length, 0);

    const missingReason = await api.patch(`/api/v1/clients/${id}/status`).set(master).send({ status: 'SUSPENDED' });
    assert.equal(missingReason.status, 400);
    const suspended = await api.patch(`/api/v1/clients/${id}/status`).set(master).send({ status: 'SUSPENDED', reason: 'Non-payment of dues' });
    assert.equal(suspended.status, 200);
    assert.equal((await api.get('/api/v1/products').set(newAdmin)).status, 401);
    const log = h.fake.AuditLog.docs.find((d) => d.action === 'TENANT_STATUS_CHANGED' && d.metadata?.next === 'SUSPENDED');
    assert.equal(log.metadata.previous, 'ACTIVE');
    assert.equal(log.metadata.reason, 'Non-payment of dues');
    assert.equal((await api.get('/api/v1/clients/stats').set(master)).body.data.clientsByStatus.SUSPENDED, 1);
    assert.equal((await api.patch(`/api/v1/clients/${id}/status`).set(master).send({ status: 'DELETED' })).status, 400);

    const summary = await api.get(`/api/v1/clients/${id}/summary`).set(master);
    assert.equal(summary.status, 200);
    assert.equal(summary.body.data.users.total, 1);

    const dash = await api.get('/api/v1/master/dashboard').set(master);
    assert.equal(dash.status, 200);
    assert.ok(dash.body.data.clients.total >= 2);
    assert.equal((await api.get('/api/v1/master/dashboard').set(admin)).status, 403);
  });

  await t.test('audit log API is Master-only, paginated, and never contains secrets', async () => {
    const res = await api.get('/api/v1/audit-logs?limit=5').set(master);
    assert.equal(res.status, 200); assert.ok(res.body.data.items.length <= 5);
    const text = JSON.stringify(res.body).toLowerCase();
    for (const s of ['passwordhash', PASSWORD.toLowerCase(), 'refreshtoken', 'bearer ']) assert.ok(!text.includes(s), s);
    assert.equal((await api.get('/api/v1/audit-logs').set(admin)).status, 403);
  });

  await t.test('unimplemented modules return 501 NOT_IMPLEMENTED instead of faking behaviour', async () => {
    // Tally is implemented as of Phase 6 (see tests/api/tally.api.test.js); only genuinely-unimplemented routes remain here.
    // Phase 9 replaced the former /invoices/export and /reports placeholders with real implementations
    // (covered in depth by tests/api/reports.test.js); assert their real behaviour here instead of 501.
    const exp = await api.get('/api/v1/invoices/export').set(admin);
    assert.equal(exp.status, 200);
    assert.match(exp.headers['content-type'], /text\/csv/);
    const catalog = await api.get('/api/v1/reports').set(admin);
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.data.some((r) => r.key === 'invoice-summary'));
    assert.equal((await api.get('/api/v1/data-requests').set(admin)).status, 501);
  });
});
