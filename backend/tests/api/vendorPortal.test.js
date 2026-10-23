import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('Phase 7: vendor portal, assignment lifecycle, and the full assignment-chain invariant', async (t) => {
  const h = await createHarness();
  const { api, A, B, master } = h;
  const m = h.bearer((await h.login(master.email)).token);
  const adminHeader = (tenantId) => ({ ...m, 'X-Admin-Tenant-Id': String(tenantId) });

  // ---- Master Admin vendor management --------------------------------------------------
  await t.test('create vendor: valid, duplicate email rejected', async () => {
    const res = await api.post('/api/v1/vendors').set(m).send({
      name: 'Vendor B', contactEmail: 'vendorb@demo.test',
      user: { name: 'Vendor B User', email: 'vendorb@example.test', password: 'Dev-Only-Pass-123' },
    });
    assert.equal(res.status, 201);
    h.vendorB = res.body.data.vendor;
    h.vendorBUserEmail = 'vendorb@example.test';

    const dup = await api.post('/api/v1/vendors').set(m).send({
      name: 'Vendor B dup', contactEmail: 'x@demo.test',
      user: { name: 'dup', email: 'vendorb@example.test', password: 'Dev-Only-Pass-123' },
    });
    assert.equal(dup.status, 409);
  });

  await t.test('vendor detail returns vendor + assignment history; update changes status', async () => {
    const detail = await api.get(`/api/v1/vendors/${h.vendor._id}`).set(m);
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.body.data.assignments));
    assert.ok(detail.body.data.assignments.some((a) => String(a.tenantId) === String(A.tenant._id) && a.status === 'ACTIVE'));

    const upd = await api.patch(`/api/v1/vendors/${h.vendor._id}`).set(m).send({ phone: '9999999999' });
    assert.equal(upd.status, 200);
  });

  await t.test('assignment lifecycle: assign, duplicate-active rejected, deactivate requires reason, reactivate', async () => {
    const assign = await api.post(`/api/v1/vendors/${h.vendorB._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });
    assert.equal(assign.status, 201);
    const assignmentId = assign.body.data._id;

    const dup = await api.post(`/api/v1/vendors/${h.vendorB._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });
    assert.equal(dup.status, 409);

    const noReason = await api.patch(`/api/v1/vendors/${h.vendorB._id}/assignments/${assignmentId}`).set(m).send({ action: 'deactivate' });
    assert.equal(noReason.status, 400);

    const deactivate = await api.patch(`/api/v1/vendors/${h.vendorB._id}/assignments/${assignmentId}`).set(m).send({ action: 'deactivate', reason: 'Contract ended' });
    assert.equal(deactivate.status, 200);
    assert.equal(deactivate.body.data.status, 'INACTIVE');

    const reactivate = await api.patch(`/api/v1/vendors/${h.vendorB._id}/assignments/${assignmentId}`).set(m).send({ action: 'reactivate' });
    assert.equal(reactivate.status, 200);
    assert.equal(reactivate.body.data.status, 'ACTIVE');

    const history = await api.get(`/api/v1/vendors/${h.vendorB._id}/assignments`).set(m);
    assert.equal(history.status, 200);
    assert.ok(history.body.data.length >= 1);
  });

  await t.test('invalid vendor / nonexistent tenant rejected', async () => {
    assert.equal((await api.post('/api/v1/vendors/000000000000000000000000/assignments').set(m).send({ tenantId: String(A.tenant._id) })).status, 404);
    assert.equal((await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(m).send({ tenantId: '000000000000000000000000' })).status, 404);
  });

  await t.test('IDOR: cannot deactivate/reactivate another vendor\'s assignment via its id', async () => {
    const vendorBAssignments = await api.get(`/api/v1/vendors/${h.vendorB._id}/assignments`).set(m);
    const otherAssignmentId = vendorBAssignments.body.data[0]._id;
    const res = await api.patch(`/api/v1/vendors/${h.vendor._id}/assignments/${otherAssignmentId}`).set(m).send({ action: 'deactivate', reason: 'x' });
    assert.equal(res.status, 404);
  });

  // ---- Concurrency: duplicate-active-assignment race -------------------------------------
  await t.test('concurrency: two simultaneous assign requests for the same (vendor, tenant) pair yield only one ACTIVE assignment', async () => {
    const vendorC = (await api.post('/api/v1/vendors').set(m).send({
      name: 'Vendor C', contactEmail: 'vendorc@demo.test',
      user: { name: 'Vendor C User', email: 'vendorc@example.test', password: 'Dev-Only-Pass-123' },
    })).body.data.vendor;
    const [r1, r2] = await Promise.all([
      api.post(`/api/v1/vendors/${vendorC._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) }),
      api.post(`/api/v1/vendors/${vendorC._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [201, 409]);
    const activeCount = h.fake.VendorClientAssignment.docs.filter(
      (d) => String(d.vendorId) === String(vendorC._id) && String(d.tenantId) === String(A.tenant._id) && d.status === 'ACTIVE',
    ).length;
    assert.equal(activeCount, 1);
  });

  // ---- The core access-chain invariant ---------------------------------------------------
  await t.test('vendor sees only actively-assigned tenants; two active assignments both allowed, a third unassigned tenant denied', async () => {
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });

    const mine = await api.get('/api/v1/vendors/me/clients').set(v);
    assert.equal(mine.status, 200);
    const ids = mine.body.data.map((x) => String(x.id));
    assert.ok(ids.includes(String(A.tenant._id)));
    assert.ok(ids.includes(String(B.tenant._id)));

    assert.equal((await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v)).status, 200);
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${B.tenant._id}/invoices`).set(v)).status, 200);

    const thirdTenant = await h.mkTenant('C', { withInvoice: false });
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${thirdTenant.tenant._id}/invoices`).set(v)).status, 403);

    // cleanup: remove B assignment so subsequent tests are unaffected
    await api.delete(`/api/v1/vendors/${h.vendor._id}/assignments/${B.tenant._id}`).set(m);
  });

  await t.test('IDOR: vendor manipulates invoice id directly to reach another tenant\'s invoice (not via tenant-scoped listing)', async () => {
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.ok([403, 404].includes((await api.get(`/api/v1/invoices/${B.invoice._id}`).set(v)).status));
    assert.ok([403, 404].includes((await api.get(`/api/v1/invoices/${B.invoice._id}/pdf`).set(v)).status));
    assert.ok([403, 404].includes((await api.get(`/api/v1/invoices/${B.invoice._id}/tally-sync`).set(v)).status));
    // Own assigned tenant's invoice id works fine.
    assert.equal((await api.get(`/api/v1/invoices/${A.invoice._id}`).set(v)).status, 200);
  });

  await t.test('vendor user deactivated but assignment still ACTIVE -> denied (via PATCH /vendors/:vendorId)', async () => {
    const off = await api.patch(`/api/v1/vendors/${h.vendor._id}`).set(m).send({ userStatus: 'INACTIVE' });
    assert.equal(off.status, 200);
    const loginAttempt = await api.post('/api/v1/auth/login').send({ email: h.vendorUser.email, password: 'Dev-Only-Pass-123' });
    assert.notEqual(loginAttempt.status, 200);
    const on = await api.patch(`/api/v1/vendors/${h.vendor._id}`).set(m).send({ userStatus: 'ACTIVE' });
    assert.equal(on.status, 200);
  });

  await t.test('vendor active but assignment INACTIVE -> denied', async () => {
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    await api.delete(`/api/v1/vendors/${h.vendor._id}/assignments/${A.tenant._id}`).set(m);
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v)).status, 403);
    await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) });
  });

  await t.test('tenant SUSPENDED but vendor assignment ACTIVE -> denied for vendor; Master Admin still allowed via admin-tenant-context', async () => {
    const suspend = await api.patch(`/api/v1/clients/${A.tenant._id}/status`).set(m).send({ status: 'SUSPENDED', reason: 'Non-payment of dues' });
    assert.equal(suspend.status, 200);
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.equal((await api.get(`/api/v1/vendors/me/clients/${A.tenant._id}/invoices`).set(v)).status, 403);
    const adminStill = await api.get(`/api/v1/invoices/${A.invoice._id}`).set(adminHeader(A.tenant._id));
    assert.equal(adminStill.status, 200);
    await api.patch(`/api/v1/clients/${A.tenant._id}/status`).set(m).send({ status: 'ACTIVE' });
  });

  // ---- Client-side vendor abstraction ------------------------------------------------------
  await t.test('Client Admin NEVER sees internal vendors (hidden from clients per LauncherDesk ERP architecture)', async () => {
    const aAdmin = h.bearer((await h.login(A.admin.email)).token);
    const mine = await api.get(`/api/v1/clients/${A.tenant._id}/vendors`).set(aAdmin);
    assert.equal(mine.status, 200);
    assert.deepEqual(mine.body.data, []);

    const bAdmin = h.bearer((await h.login(B.admin.email)).token);
    const bOwn = await api.get(`/api/v1/clients/${B.tenant._id}/vendors`).set(bAdmin);
    assert.equal(bOwn.status, 200);
    assert.deepEqual(bOwn.body.data, []);
    // Even passing A's tenantId in the URL, a Client Admin only ever sees an empty array
    const spoofed = await api.get(`/api/v1/clients/${A.tenant._id}/vendors`).set(bAdmin);
    assert.equal(spoofed.status, 200);
    assert.deepEqual(spoofed.body.data, []);
  });

  // ---- RBAC matrix for vendor permissions -------------------------------------------------
  await t.test('RBAC: vendors.* is MASTER_ADMIN only; vendor_portal routes require GST_VENDOR role', async () => {
    const aAdmin = h.bearer((await h.login(A.admin.email)).token);
    const v = h.bearer((await h.login(h.vendorUser.email)).token);
    for (const [method, path] of [['get', '/api/v1/vendors'], ['post', '/api/v1/vendors']]) {
      assert.equal((await api[method](path).set(aAdmin).send({})).status, 403);
      assert.equal((await api[method](path).set(v).send({})).status, 403);
      assert.equal((await api[method](path)).status, 401);
    }
    assert.equal((await api.get('/api/v1/vendors/me/clients').set(aAdmin)).status, 403);
    assert.equal((await api.get('/api/v1/vendors/me/clients').set(m)).status, 403);
    assert.equal((await api.get('/api/v1/vendors/me/clients')).status, 401);
  });
});
