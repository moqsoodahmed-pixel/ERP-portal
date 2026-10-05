import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

const denied = (res) => assert.ok([403, 404].includes(res.status), `expected 403/404, got ${res.status}`);

test('tenant isolation', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const a = await h.login(A.admin.email);
  const aStaff = await h.login(A.staff.email);
  const A_ = h.bearer(a.token);

  await t.test('Client A cannot read Client B invoice / product / customer by id', async () => {
    for (const [path, rec] of [['invoices', B.invoice], ['products', B.product], ['customers', B.customer]]) {
      const res = await api.get(`/api/v1/${path}/${rec._id}`).set(A_);
      denied(res);
      assert.ok(!JSON.stringify(res.body).includes('Business B') && !JSON.stringify(res.body).includes(rec.invoiceNumber ?? 'zzz-none') || res.status === 404);
    }
    assert.equal((await api.get(`/api/v1/invoices/${A.invoice._id}`).set(A_)).status, 200);
  });

  await t.test('Client A lists contain only Client A data', async () => {
    for (const path of ['invoices', 'products', 'customers', 'users']) {
      const res = await api.get(`/api/v1/${path}`).set(A_);
      assert.equal(res.status, 200);
      assert.ok(res.body.data.items.length > 0);
      assert.ok(res.body.data.items.every((i) => String(i.tenantId) === String(A.tenant._id)), path);
    }
  });

  await t.test('Client A cannot update, archive or cancel Client B records', async () => {
    denied(await api.patch(`/api/v1/products/${B.product._id}`).set(A_).send({ productName: 'hacked' }));
    denied(await api.delete(`/api/v1/products/${B.product._id}`).set(A_));
    denied(await api.patch(`/api/v1/customers/${B.customer._id}`).set(A_).send({ name: 'hacked' }));
    denied(await api.post(`/api/v1/invoices/${B.invoice._id}/cancel`).set(A_).send({ reason: 'cross-tenant attempt' }));
    const bProd = h.fake.Product.docs.find((d) => d._id === String(B.product._id));
    assert.equal(bProd.productName, 'B Widget'); assert.notEqual(bProd.isDeleted, true);
    assert.equal(h.fake.Invoice.docs.find((d) => d._id === String(B.invoice._id)).invoiceStatus, 'DRAFT');
  });

  await t.test('tenantId manipulation in query or body is refused, audited as a security event, and has no effect', async () => {
    const before = h.fake.Product.docs.length;
    const q = await api.get(`/api/v1/products?tenantId=${B.tenant._id}`).set(A_);
    assert.equal(q.status, 403); assert.equal(q.body.error.code, 'TENANT_ACCESS_ERROR');
    const b = await api.post('/api/v1/products').set(A_).send({ tenantId: String(B.tenant._id), productName: 'Smuggled', sellingPrice: '1' });
    assert.equal(b.status, 403);
    assert.equal(h.fake.Product.docs.length, before);
    assert.ok(h.fake.SecurityEvent.docs.some((e) => e.type === 'CROSS_TENANT_ACCESS'));
    const admin = await api.get('/api/v1/products').set(A_).set('X-Admin-Tenant-Id', String(B.tenant._id));
    assert.ok(admin.body.data.items.every((i) => String(i.tenantId) === String(A.tenant._id)), 'admin-context header must not work for client roles');
  });

  await t.test('invoices cannot reference another tenant\'s customer or products', async () => {
    const mk = (customerId, productId) => ({ customerId: String(customerId), invoiceDate: '2026-04-02', gstApplicable: true, items: [{ productId: String(productId), quantity: '1' }] });
    denied(await api.post('/api/v1/invoices').set(A_).send(mk(B.customer._id, A.product._id)));
    denied(await api.post('/api/v1/invoices').set(A_).send(mk(A.customer._id, B.product._id)));
    assert.equal((await api.post('/api/v1/invoices').set(A_).send(mk(A.customer._id, A.product._id))).status, 201);
  });

  await t.test('same product codes exist independently per tenant', async () => {
    assert.equal(A.product.productCode, 'PROD-000001'); assert.equal(B.product.productCode, 'PROD-000001');
  });

  await t.test('Vendor: assigned client allowed, unassigned client denied, other APIs denied', async () => {
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    const mine = await api.get('/api/v1/vendors/me/clients').set(v);
    assert.deepEqual(mine.body.data.map((c) => String(c.id)), [String(A.tenant._id)]);
    const ok = await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v);
    assert.equal(ok.status, 200); assert.ok(ok.body.data.items.every((i) => String(i.tenantId) === String(A.tenant._id)));
    const no = await api.get(`/api/v1/vendors/me/clients/${B.tenant._id}/invoices`).set(v);
    assert.equal(no.status, 403); assert.equal(no.body.error.code, 'TENANT_ACCESS_ERROR');
    assert.equal((await api.get('/api/v1/vendors/me/clients/not-an-id/invoices').set(v)).status, 403);
    for (const p of ['products', 'customers', 'invoices', 'users']) assert.equal((await api.get(`/api/v1/${p}`).set(v)).status, 403, p);
    assert.equal((await api.get(`/api/v1/products?tenantId=${A.tenant._id}`).set(v)).status, 403);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'VENDOR_DATA_ACCESS'));
  });

  await t.test('Vendor access ends immediately when unassigned and is re-checked on every request', async () => {
    const m = h.bearer((await h.login(h.master.email)).token);
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.equal((await api.delete(`/api/v1/vendors/${h.vendor._id}/assignments/${A.tenant._id}`).set(m)).status, 200);
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v)).status, 403);
    assert.equal((await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) })).status, 201);
    assert.equal((await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) })).status, 409);
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v)).status, 200);
    assert.ok(['VENDOR_ASSIGNED', 'VENDOR_UNASSIGNED'].every((x) => h.fake.AuditLog.docs.some((d) => d.action === x)));
  });

  await t.test('Client users cannot reach Master Admin APIs', async () => {
    for (const who of [a, aStaff]) {
      for (const [m, p] of [['get', '/api/v1/clients'], ['get', '/api/v1/clients/stats'], ['post', '/api/v1/clients'], ['get', '/api/v1/audit-logs'], ['get', '/api/v1/vendors'], ['post', '/api/v1/vendors'], ['get', '/api/v1/master/dashboard']]) {
        assert.equal((await api[m](p).set(h.bearer(who.token)).send({})).status, 403, `${m} ${p}`);
      }
    }
    const vend = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.equal((await api.get('/api/v1/clients').set(vend)).status, 403);
    assert.equal((await api.get('/api/v1/audit-logs').set(vend)).status, 403);
    assert.equal((await api.get('/api/v1/master/dashboard').set(vend)).status, 403);
    assert.equal((await api.get('/api/v1/clients')).status, 401);
    assert.equal((await api.get('/api/v1/master/dashboard')).status, 401);
  });

  await t.test('client validation: bad GSTIN/PAN/status/pagination/sort and invalid ObjectIds are rejected, not 500s', async () => {
    const m = h.bearer((await h.login(h.master.email)).token);
    assert.equal((await api.post('/api/v1/clients').set(m).send({ businessName: 'Bad GST', gstin: 'NOTAGSTIN' })).status, 400);
    assert.equal((await api.post('/api/v1/clients').set(m).send({ businessName: 'Bad PAN', pan: 'invalid' })).status, 400);
    assert.equal((await api.get('/api/v1/clients?status=NOT_A_STATUS').set(m)).status, 400);
    // Unknown sort fields are safely ignored (whitelist), never passed through to Mongo as an operator.
    assert.equal((await api.get('/api/v1/clients?sort=$where').set(m)).status, 200);
    assert.equal((await api.get('/api/v1/clients?limit=99999').set(m)).status, 400);
    assert.equal((await api.get('/api/v1/clients/not-an-object-id').set(m)).status, 400);
    assert.equal((await api.patch(`/api/v1/clients/${A.tenant._id}/status`).set(m).send({ status: 'INACTIVE' })).status, 400);
  });

  await t.test('Master Admin needs an explicit tenant context, and every such access is audited', async () => {
    const m = h.bearer((await h.login(h.master.email)).token);
    const none = await api.get('/api/v1/invoices').set(m);
    assert.equal(none.status, 400);
    assert.equal((await api.get('/api/v1/invoices').set(m).set('X-Admin-Tenant-Id', 'f'.repeat(24))).status, 404);
    const before = h.fake.AuditLog.docs.filter((d) => d.action === 'ADMIN_TENANT_ACCESS').length;
    const res = await api.get('/api/v1/invoices').set(m).set('X-Admin-Tenant-Id', String(B.tenant._id));
    assert.equal(res.status, 200);
    assert.ok(res.body.data.items.every((i) => String(i.tenantId) === String(B.tenant._id)));
    const entries = h.fake.AuditLog.docs.filter((d) => d.action === 'ADMIN_TENANT_ACCESS');
    assert.equal(entries.length, before + 1);
    assert.equal(entries.at(-1).actorRole, 'MASTER_ADMIN'); assert.equal(String(entries.at(-1).tenantId), String(B.tenant._id));
    assert.equal((await api.post('/api/v1/products').set(m).set('X-Admin-Tenant-Id', String(B.tenant._id)).send({ productName: 'x', sellingPrice: '1' })).status, 403, 'master lacks products.create');
  });
});
