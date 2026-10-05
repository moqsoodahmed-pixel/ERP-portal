import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('business profile', async (t) => {
  const h = await createHarness();
  const { api } = h;
  // Fresh, profile-less tenants: the shared A/B fixtures already have a Business Profile (invoices require one).
  const A = await h.mkTenant('BP-A', { withInvoice: false });
  const B = await h.mkTenant('BP-B', { withInvoice: false });
  const admin = h.bearer((await h.login(A.admin.email)).token);
  const staff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);

  await t.test('no profile yet -> 404', async () => {
    const res = await api.get('/api/v1/business-profile').set(admin);
    assert.equal(res.status, 404);
  });

  await t.test('Client Admin can create the profile; a second create conflicts', async () => {
    const created = await api.post('/api/v1/business-profile').set(admin).send({
      displayName: 'Acme Traders', gstin: '27AAAPL1234C1Z5', mobile: '9876543210', email: 'profile@acme.test',
      address: { line1: 'Street 1', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001' },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.displayName, 'Acme Traders');
    assert.equal(created.body.data.tenantId, String(A.tenant._id));

    const again = await api.post('/api/v1/business-profile').set(admin).send({ displayName: 'Dup' });
    assert.equal(again.status, 409);

    const fetched = await api.get('/api/v1/business-profile').set(admin);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.data.displayName, 'Acme Traders');

    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'BUSINESS_PROFILE_CREATED'));
  });

  await t.test('format validation rejects bad GSTIN / website / pincode and unknown fields', async () => {
    assert.equal((await api.patch('/api/v1/business-profile').set(admin).send({ gstin: 'bad' })).status, 400);
    assert.equal((await api.patch('/api/v1/business-profile').set(admin).send({ website: 'not-a-url' })).status, 400);
    assert.equal((await api.patch('/api/v1/business-profile').set(admin).send({ address: { pincode: '12' } })).status, 400);
    assert.equal((await api.post('/api/v1/business-profile').set(admin).send({ displayName: 'x', unexpected: true })).status, 400);
  });

  await t.test('Client Admin can update; GSTIN/address changes are flagged sensitive in the audit entry', async () => {
    const updated = await api.patch('/api/v1/business-profile').set(admin).send({ gstin: '29AAAPL1234C1Z3' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.gstin, '29AAAPL1234C1Z3');
    const log = h.fake.AuditLog.docs.find((d) => d.action === 'BUSINESS_PROFILE_UPDATED');
    assert.ok(log.metadata.sensitiveFieldsChanged.includes('gstin'));
  });

  await t.test('Client User has no business.view permission by default: 403 on all business-profile routes', async () => {
    assert.equal((await api.get('/api/v1/business-profile').set(staff)).status, 403);
    assert.equal((await api.patch('/api/v1/business-profile').set(staff).send({ mobile: '1' })).status, 403);
    assert.equal((await api.post('/api/v1/business-profile').set(staff).send({ displayName: 'x' })).status, 403);
  });

  await t.test('no bearer token -> 401', async () => {
    assert.equal((await api.get('/api/v1/business-profile')).status, 401);
  });

  await t.test('tenant isolation: Client B has its own profile, never sees Client A data', async () => {
    const notFound = await api.get('/api/v1/business-profile').set(bAdmin);
    assert.equal(notFound.status, 404);
    const createdB = await api.post('/api/v1/business-profile').set(bAdmin).send({ displayName: 'Beta Co' });
    assert.equal(createdB.status, 201);
    assert.notEqual(createdB.body.data.tenantId, String(A.tenant._id));
    const fetchedA = await api.get('/api/v1/business-profile').set(admin);
    assert.equal(fetchedA.body.data.displayName, 'Acme Traders');
  });

  await t.test('Master Admin requires X-Admin-Tenant-Id header for administrative access, and it is audited', async () => {
    const master = h.bearer((await h.login('master@example.test')).token);
    const noHeader = await api.get('/api/v1/business-profile').set(master);
    assert.equal(noHeader.status, 400);
    const withHeader = await api.get('/api/v1/business-profile').set(master).set('X-Admin-Tenant-Id', String(A.tenant._id));
    assert.equal(withHeader.status, 200);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'ADMIN_TENANT_ACCESS'));
  });
});
