import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';
import { buildPhase9Fixtures, EXPECTED, aprilQuery } from '../helpers/phase9Fixtures.js';

test('Phase 9: role-aware dashboards — aggregation correctness, scoping, date ranges, RBAC', async (t) => {
  const h = await createHarness();
  const { api, A, B, master, vendor, vendorUser, repos } = h;
  await buildPhase9Fixtures(h);
  const m = h.bearer((await h.login(master.email)).token);
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(vendorUser.email)).token);

  // Filings: A (vendor assigned) IN_PROGRESS + one open issue; B (vendor NOT assigned) READY_FOR_REVIEW.
  const filingA = await repos.gstFilings.create(A.tenant._id, { periodKey: '2026-04', returnType: 'GSTR_1', status: 'IN_PROGRESS', vendorUserId: String(vendorUser._id), milestones: [] }, master._id);
  await repos.gstFilings.create(B.tenant._id, { periodKey: '2026-04', returnType: 'GSTR_3B', status: 'READY_FOR_REVIEW', milestones: [] }, master._id);
  await repos.gstFilingIssues.create(A.tenant._id, { filingId: String(filingA._id), type: 'TALLY_SYNC', severity: 'HIGH', title: 'Unsynced', status: 'OPEN', raisedBy: vendorUser._id });

  await t.test('client dashboard: totals equal hand-computed fixture values (ISSUED only, stored GST fields)', async () => {
    const res = await api.get(`/api/v1/dashboard?${aprilQuery}`).set(aAdmin);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.range.preset, 'custom');
    assert.deepEqual(d.invoices.byStatus, EXPECTED.aprilByStatus);
    assert.deepEqual(d.invoices.issued, EXPECTED.aprilIssued);
    assert.deepEqual({ total: d.tally.total, synced: d.tally.synced, failed: d.tally.failed, pending: d.tally.pending }, EXPECTED.aprilTally);
    assert.equal(d.customers.active, 1);
    assert.equal(d.products.active, 1);
    assert.equal(d.gstFilings.latestPeriod, '2026-04');
    assert.equal(d.gstFilings.filings.length, 1);
    assert.equal(d.gstFilings.filings[0].status, 'IN_PROGRESS');
    assert.equal(d.gstFilings.openIssuesTotal, 1);
  });

  await t.test('client dashboard: payment metrics are explicitly NOT APPLICABLE (null + reason), never a fabricated zero', async () => {
    const d = (await api.get(`/api/v1/dashboard?${aprilQuery}`).set(aAdmin)).body.data;
    assert.equal(d.invoices.payments.available, false);
    assert.equal(d.invoices.payments.paidAmount, null);
    assert.equal(d.invoices.payments.outstandingAmount, null);
    assert.match(d.invoices.payments.reason, /no payment-recording workflow/);
  });

  await t.test('client dashboard: tenant isolation — Client B sees only its own numbers', async () => {
    const d = (await api.get(`/api/v1/dashboard?${aprilQuery}`).set(bAdmin)).body.data;
    assert.equal(d.invoices.issued.count, EXPECTED.bAprilIssued.count);
    assert.equal(d.invoices.issued.grandTotal, EXPECTED.bAprilIssued.grandTotal);
    assert.equal(d.invoices.byStatus.CANCELLED, 0);
    assert.equal(d.gstFilings.filings[0].returnType, 'GSTR_3B');
  });

  await t.test('client dashboard: date-range filtering — May window contains only inv5', async () => {
    const d = (await api.get('/api/v1/dashboard?range=custom&from=2026-05-01&to=2026-05-31').set(aAdmin)).body.data;
    assert.deepEqual(d.invoices.issued, { count: 1, taxableAmount: '700.00', cgst: '63.00', sgst: '63.00', igst: '0.00', totalTax: '126.00', totalGst: '126.00', grandTotal: '826.00' });
    assert.deepEqual(d.invoices.byStatus, { DRAFT: 0, ISSUED: 1, CANCELLED: 0 });
  });

  await t.test('client dashboard: a range with no data reports real zeros (distinct from not-applicable)', async () => {
    const d = (await api.get('/api/v1/dashboard?range=custom&from=2025-01-01&to=2025-01-31').set(aAdmin)).body.data;
    assert.equal(d.invoices.available, true);
    assert.equal(d.invoices.issued.count, 0);
    assert.equal(d.invoices.issued.grandTotal, '0.00');
  });

  await t.test('client dashboard: CLIENT_USER sections gated by permission (tally/filings not applicable)', async () => {
    const d = (await api.get(`/api/v1/dashboard?${aprilQuery}`).set(aStaff)).body.data;
    assert.equal(d.invoices.issued.count, 3);
    assert.deepEqual(d.tally, { available: false, reason: 'PERMISSION_REQUIRED', permission: 'tally.view' });
    assert.equal(d.gstFilings.available, false);
  });

  await t.test('client dashboard: invalid / unreasonable ranges rejected', async () => {
    assert.equal((await api.get('/api/v1/dashboard?range=custom&from=2026-05-01&to=2026-04-01').set(aAdmin)).status, 400);
    assert.equal((await api.get('/api/v1/dashboard?range=custom&from=2020-01-01&to=2026-04-01').set(aAdmin)).status, 400);
    assert.equal((await api.get('/api/v1/dashboard?range=custom&from=2026-01-01').set(aAdmin)).status, 400);
    assert.equal((await api.get('/api/v1/dashboard?range=last_decade').set(aAdmin)).status, 400);
    assert.equal((await api.get('/api/v1/dashboard?range=this_month').set(aAdmin)).status, 200);
  });

  await t.test('client dashboard: manipulated tenantId is rejected for tenant users; Master Admin uses the audited header', async () => {
    assert.equal((await api.get(`/api/v1/dashboard?${aprilQuery}&tenantId=${B.tenant._id}`).set(aAdmin)).status, 403);
    const own = await api.get(`/api/v1/dashboard?${aprilQuery}&tenantId=${A.tenant._id}`).set(aAdmin);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.invoices.issued.count, 3);
    assert.equal((await api.get(`/api/v1/dashboard?${aprilQuery}`).set(m)).status, 400); // header required
    const viaHeader = await api.get(`/api/v1/dashboard?${aprilQuery}&tenantId=${B.tenant._id}`).set({ ...m, 'X-Admin-Tenant-Id': String(A.tenant._id) });
    assert.equal(viaHeader.status, 200);
    assert.deepEqual(viaHeader.body.data.invoices.issued, EXPECTED.aprilIssued); // header wins, query tenantId ignored
    assert.equal((await api.get('/api/v1/dashboard').set(v)).status, 403); // vendors have no tenant dashboard
  });

  await t.test('master dashboard: Phase 2 fields preserved + cross-tenant filing/Tally/security aggregates', async () => {
    const res = await api.get(`/api/v1/master/dashboard?${aprilQuery}`).set(m);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.clients.total, 2); assert.equal(d.clients.active, 2);
    assert.ok(d.users.total >= 6);
    assert.equal(d.gstVendors, 1); assert.equal(d.activeVendorAssignments, 1);
    assert.deepEqual(d.gstFilings.pipeline, { NOT_STARTED: 0, IN_PROGRESS: 1, READY_FOR_REVIEW: 1, SUBMITTED: 0, FILED: 0 });
    assert.equal(d.gstFilings.openIssues, 1);
    assert.equal(d.tallySync.byStatus.SYNCED, 1); assert.equal(d.tallySync.byStatus.FAILED, 1);
    assert.deepEqual(d.invoices.byStatus, { DRAFT: 1, ISSUED: 4, CANCELLED: 1 }); // A (3 issued + draft + cancelled) + B (1 issued)
    assert.equal(typeof d.securityEvents.total, 'number');
  });

  await t.test('master dashboard: security event count reflects recorded events (cross-tenant denial is recorded)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const before = (await api.get(`/api/v1/master/dashboard?range=custom&from=${today}&to=${today}`).set(m)).body.data.securityEvents;
    await api.get(`/api/v1/dashboard?tenantId=${B.tenant._id}`).set(aAdmin); // HIGH cross-tenant event
    const after = (await api.get(`/api/v1/master/dashboard?range=custom&from=${today}&to=${today}`).set(m)).body.data.securityEvents;
    assert.equal(after.total, before.total + 1);
    assert.equal(after.highOrCritical, before.highOrCritical + 1);
  });

  await t.test('master dashboard: still inaccessible to every other role', async () => {
    for (const who of [aAdmin, aStaff, v]) assert.equal((await api.get('/api/v1/master/dashboard').set(who)).status, 403);
    assert.equal((await api.get('/api/v1/master/dashboard')).status, 401);
  });

  await t.test('vendor dashboard: only ACTIVELY-assigned ACTIVE tenants are counted', async () => {
    let d = (await api.get('/api/v1/vendors/me/dashboard').set(v)).body.data;
    assert.equal(d.assignedClients, 1);
    assert.deepEqual(d.gstFilings.pipeline, { NOT_STARTED: 0, IN_PROGRESS: 1, READY_FOR_REVIEW: 0, SUBMITTED: 0, FILED: 0 });
    assert.equal(d.gstFilings.openIssues, 1);
    assert.equal(d.gstFilings.inProgress, 1);
    assert.deepEqual(d.clients.map((c) => String(c.tenantId)), [String(A.tenant._id)]);

    await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });
    d = (await api.get('/api/v1/vendors/me/dashboard').set(v)).body.data;
    assert.equal(d.gstFilings.pipeline.READY_FOR_REVIEW, 1);
    assert.equal(d.gstFilings.total, 2);

    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'SUSPENDED', reason: 'Phase 9 dashboard test' });
    d = (await api.get('/api/v1/vendors/me/dashboard').set(v)).body.data;
    assert.equal(d.activeAssignedClients, 1);
    assert.equal(d.gstFilings.pipeline.READY_FOR_REVIEW, 0, 'suspended tenant excluded');
    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'ACTIVE' });

    await api.delete(`/api/v1/vendors/${vendor._id}/assignments/${B.tenant._id}`).set(m);
    d = (await api.get('/api/v1/vendors/me/dashboard').set(v)).body.data;
    assert.equal(d.gstFilings.total, 1, 'unassigned tenant excluded');
  });

  await t.test('vendor dashboard: Phase 18 bill + Tally job summaries scoped to assigned tenants only', async () => {
    const billA = await repos.bills.create(A.tenant._id, {
      billNumber: 'BA-1', billDate: new Date(), vendorName: 'V', amount: 100, status: 'SUBMITTED', tallyStatus: 'NOT_READY', documentIds: [], history: [],
    }, A.admin._id);
    const billB = await repos.bills.create(B.tenant._id, {
      billNumber: 'BB-1', billDate: new Date(), vendorName: 'V', amount: 200, status: 'READY_FOR_TALLY', tallyStatus: 'QUEUED', documentIds: [], history: [],
    }, B.admin._id);
    await repos.tallyJobs.create(A.tenant._id, {
      billIntakeId: billA._id, type: 'SYNC_BILL_TO_TALLY', status: 'QUEUED', idempotencyKey: `${A.tenant._id}:${billA._id}:SYNC_BILL_TO_TALLY`,
    }, master._id);
    await repos.tallyJobs.create(B.tenant._id, {
      billIntakeId: billB._id, type: 'SYNC_BILL_TO_TALLY', status: 'FAILED', idempotencyKey: `${B.tenant._id}:${billB._id}:SYNC_BILL_TO_TALLY`,
    }, master._id);
    const d = (await api.get('/api/v1/vendors/me/dashboard').set(v)).body.data;
    // Vendor is assigned to A only at this point in the suite — B's bill/job must not be counted.
    assert.equal(d.bills.byStatus.SUBMITTED, 1);
    assert.equal(d.bills.byStatus.READY_FOR_TALLY, 0);
    assert.equal(d.tallyJobs.byStatus.QUEUED, 1);
    assert.equal(d.tallyJobs.byStatus.FAILED, 0);
    assert.equal(d.tallyJobs.retryable, 0);
  });

  await t.test('vendor dashboard: other roles denied', async () => {
    assert.equal((await api.get('/api/v1/vendors/me/dashboard').set(aAdmin)).status, 403);
    assert.equal((await api.get('/api/v1/vendors/me/dashboard').set(m)).status, 403);
  });
});
