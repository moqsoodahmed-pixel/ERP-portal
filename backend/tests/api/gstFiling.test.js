import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('Phase 8: GST filing workflow tracker — creation, access chain, state machine, issues, reconciliation, readiness', async (t) => {
  const h = await createHarness();
  const { api, A, B, master, vendor, vendorUser } = h;
  const m = h.bearer((await h.login(master.email)).token);
  const adminHeader = (tenantId) => ({ ...m, 'X-Admin-Tenant-Id': String(tenantId) });
  const v = h.bearer((await h.login(vendorUser.email)).token);
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);

  // ---- creation ------------------------------------------------------------------------
  await t.test('create: Master Admin creates a filing for an assigned vendor; validations enforced', async () => {
    const res = await api.post('/api/v1/gst-filings').set(adminHeader(A.tenant._id)).send({
      periodKey: '2026-04', returnType: 'GSTR_1', vendorUserId: String(vendorUser._id),
    });
    assert.equal(res.status, 201);
    h.filingA = res.body.data;
    assert.equal(h.filingA.status, 'NOT_STARTED');
    assert.equal(h.filingA.progressPercent, 0);
    assert.ok(Array.isArray(h.filingA.milestones) && h.filingA.milestones.length > 0);

    const dup = await api.post('/api/v1/gst-filings').set(adminHeader(A.tenant._id)).send({ periodKey: '2026-04', returnType: 'GSTR_1' });
    assert.equal(dup.status, 409);

    const badPeriod = await api.post('/api/v1/gst-filings').set(adminHeader(A.tenant._id)).send({ periodKey: '2026-13', returnType: 'GSTR_1' });
    assert.equal(badPeriod.status, 400);

    const badReturnType = await api.post('/api/v1/gst-filings').set(adminHeader(A.tenant._id)).send({ periodKey: '2026-05', returnType: 'GSTR_9' });
    assert.equal(badReturnType.status, 400);
  });

  await t.test('create: inactive tenant rejected; vendor without active assignment rejected', async () => {
    const suspend = await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'SUSPENDED', reason: 'Testing inactive tenant rejection' });
    assert.equal(suspend.status, 200);
    const onSuspended = await api.post('/api/v1/gst-filings').set(adminHeader(B.tenant._id)).send({ periodKey: '2026-04', returnType: 'GSTR_1' });
    assert.equal(onSuspended.status, 400);
    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'ACTIVE' });

    const unassignedVendorRes = await api.post('/api/v1/vendors').set(m).send({
      name: 'Vendor Unassigned', contactEmail: 'vunassigned@demo.test',
      user: { name: 'Vendor U', email: 'vunassigned@example.test', password: 'Dev-Only-Pass-123' },
    });
    const unassignedVendorUser = (await api.get(`/api/v1/vendors/${unassignedVendorRes.body.data.vendor._id}`).set(m)).body;
    const badVendorFiling = await api.post('/api/v1/gst-filings').set(adminHeader(B.tenant._id)).send({
      periodKey: '2026-04', returnType: 'GSTR_1', vendorUserId: String(unassignedVendorRes.body.data.user.id),
    });
    assert.equal(badVendorFiling.status, 400);
    void unassignedVendorUser;
  });

  await t.test('create: an assigned GST_VENDOR can create a filing for their own client; cannot for an unassigned one', async () => {
    await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });
    const ok = await api.post('/api/v1/gst-filings').set(v).send({ tenantId: String(B.tenant._id), periodKey: '2026-05', returnType: 'GSTR_3B' });
    assert.equal(ok.status, 201);
    h.filingB = ok.body.data;

    const thirdTenant = await h.mkTenant('C', { withInvoice: false });
    const denied = await api.post('/api/v1/gst-filings').set(v).send({ tenantId: String(thirdTenant.tenant._id), periodKey: '2026-05', returnType: 'GSTR_3B' });
    assert.equal(denied.status, 403);
  });

  // ---- vendor / client access chain -----------------------------------------------------
  await t.test('vendor access: assigned tenant allowed; unassigned tenant denied; inactive assignment denied', async () => {
    assert.equal((await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(v)).status, 200);

    await api.delete(`/api/v1/vendors/${vendor._id}/assignments/${A.tenant._id}`).set(m);
    assert.equal((await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(v)).status, 403);
    await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) });
    assert.equal((await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(v)).status, 200);
  });

  await t.test('vendor: Phase 18 client-workspace narrowing — own assigned client allowed, unassigned/foreign tenant denied', async () => {
    const narrowed = await api.get(`/api/v1/gst-filings?client=${A.tenant._id}`).set(v);
    assert.equal(narrowed.status, 200);
    assert.ok(narrowed.body.data.items.every((f) => String(f.tenantId) === String(A.tenant._id)));

    const thirdTenant = await h.mkTenant('FilingVendorUnassigned', { withInvoice: false });
    const foreign = await api.get(`/api/v1/gst-filings?client=${thirdTenant.tenant._id}`).set(v);
    assert.equal(foreign.status, 403, 'vendor is not assigned to this tenant — client param must not be trusted bare');
  });

  await t.test('vendor access: inactive vendor user denied', async () => {
    await api.patch(`/api/v1/vendors/${vendor._id}`).set(m).send({ userStatus: 'INACTIVE' });
    const loginAttempt = await api.post('/api/v1/auth/login').send({ email: vendorUser.email, password: 'Dev-Only-Pass-123' });
    assert.notEqual(loginAttempt.status, 200);
    await api.patch(`/api/v1/vendors/${vendor._id}`).set(m).send({ userStatus: 'ACTIVE' });
  });

  await t.test('client access: own tenant allowed, read-only on transitions; other tenant denied; can create own filing but never for another tenant', async () => {
    const own = await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(aAdmin);
    assert.equal(own.status, 200);
    const other = await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(bAdmin);
    assert.equal(other.status, 403);
    const blocked = await api.post(`/api/v1/gst-filings/${h.filingA._id}/start`).set(aAdmin);
    assert.equal(blocked.status, 403);

    // Phase 19: CLIENT_ADMIN can start their own filing (New Filing + Company Details) for their own tenant...
    const ownCreate = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2026-06', returnType: 'GSTR_1' });
    assert.equal(ownCreate.status, 201);
    assert.equal(String(ownCreate.body.data.tenantId), String(A.tenant._id));

    // ...but a client-supplied tenantId is always overwritten with their own tenant, never merely checked —
    // so a client can never create a filing workflow for another tenant by editing the request body.
    const spoofed = await api.post('/api/v1/gst-filings').set(aAdmin).send({ tenantId: String(B.tenant._id), periodKey: '2026-07', returnType: 'GSTR_1' });
    assert.equal(spoofed.status, 201);
    assert.equal(String(spoofed.body.data.tenantId), String(A.tenant._id));
  });

  await t.test('IDOR: filing id / tenant id manipulation denied', async () => {
    assert.equal((await api.get(`/api/v1/gst-filings/000000000000000000000000`).set(m)).status, 404);
    // Vendor B's filing does not belong to vendor A's assignment set in a way that matters here;
    // reuse the cross-tenant assertion: vendor cannot reach an unassigned tenant's filing via direct id.
    const thirdTenant = await h.mkTenant('D', { withInvoice: false });
    const f = await api.post('/api/v1/gst-filings').set(adminHeader(thirdTenant.tenant._id)).send({ periodKey: '2026-04', returnType: 'GSTR_1' });
    assert.equal((await api.get(`/api/v1/gst-filings/${f.body.data._id}`).set(v)).status, 403);
  });

  // ---- state machine ----------------------------------------------------------------------
  await t.test('state machine: valid transitions succeed in order; invalid transitions rejected', async () => {
    assert.equal((await api.post(`/api/v1/gst-filings/${h.filingA._id}/submit`).set(v)).status, 409); // NOT_STARTED -> SUBMITTED invalid
    assert.equal((await api.post(`/api/v1/gst-filings/${h.filingA._id}/mark-filed`).set(v)).status, 409);

    const start = await api.post(`/api/v1/gst-filings/${h.filingA._id}/start`).set(v);
    assert.equal(start.status, 200);
    assert.equal(start.body.data.status, 'IN_PROGRESS');
    assert.equal(start.body.data.history.length, 1);

    assert.equal((await api.post(`/api/v1/gst-filings/${h.filingA._id}/start`).set(v)).status, 409); // already IN_PROGRESS

    const ready = await api.post(`/api/v1/gst-filings/${h.filingA._id}/ready`).set(v);
    assert.equal(ready.status, 200);
    assert.equal(ready.body.data.status, 'READY_FOR_REVIEW');

    const submit = await api.post(`/api/v1/gst-filings/${h.filingA._id}/submit`).set(v);
    assert.equal(submit.status, 200);
    assert.equal(submit.body.data.status, 'SUBMITTED');

    const filed = await api.post(`/api/v1/gst-filings/${h.filingA._id}/mark-filed`).set(v);
    assert.equal(filed.status, 200);
    assert.equal(filed.body.data.status, 'FILED');
    assert.equal(filed.body.data.history.length, 4);

    assert.equal((await api.post(`/api/v1/gst-filings/${h.filingA._id}/start`).set(v)).status, 409); // FILED -> IN_PROGRESS invalid (terminal)
  });

  await t.test('concurrency: two simultaneous "start" calls on the same NOT_STARTED filing — only one succeeds', async () => {
    const [r1, r2] = await Promise.all([
      api.post(`/api/v1/gst-filings/${h.filingB._id}/start`).set(v),
      api.post(`/api/v1/gst-filings/${h.filingB._id}/start`).set(v),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
  });

  await t.test('general PATCH never accepts a raw status field; updates notes/dueDate/submissionInfo as MANUALLY_RECORDED', async () => {
    const patch = await api.patch(`/api/v1/gst-filings/${h.filingA._id}`).set(v).send({
      notes: 'Reviewed with client', submissionInfo: { acknowledgementNumber: 'DEMO-REF-TEST-01', notes: 'Entered from portal screenshot' },
    });
    assert.equal(patch.status, 200);
    assert.equal(patch.body.data.submissionInfo.source, 'MANUALLY_RECORDED');
    assert.equal(patch.body.data.status, 'FILED'); // unaffected by the non-status patch
  });

  // ---- issues -------------------------------------------------------------------------------
  await t.test('issues: create/update/resolve/close; resolution required; cross-tenant and cross-filing denial', async () => {
    const create = await api.post(`/api/v1/gst-filings/${h.filingB._id}/issues`).set(v).send({
      type: 'MISSING_DATA', severity: 'CRITICAL', title: 'Customer GSTIN missing', description: 'Needs correction',
    });
    assert.equal(create.status, 201);
    const issueId = create.body.data._id;
    assert.equal(create.body.data.status, 'OPEN');

    const resolveNoDescription = await api.patch(`/api/v1/gst-filings/${h.filingB._id}/issues/${issueId}`).set(v).send({ status: 'RESOLVED' });
    assert.equal(resolveNoDescription.status, 400);

    const resolve = await api.patch(`/api/v1/gst-filings/${h.filingB._id}/issues/${issueId}`).set(v).send({ status: 'RESOLVED', resolution: 'GSTIN added to customer record' });
    assert.equal(resolve.status, 200);
    assert.equal(resolve.body.data.status, 'RESOLVED');

    const close = await api.patch(`/api/v1/gst-filings/${h.filingB._id}/issues/${issueId}`).set(v).send({ status: 'CLOSED' });
    assert.equal(close.status, 200);
    assert.equal(close.body.data.status, 'CLOSED');

    // cross-filing: issue belongs to filingB, cannot be mutated via filingA's route
    const crossFiling = await api.patch(`/api/v1/gst-filings/${h.filingA._id}/issues/${issueId}`).set(v).send({ status: 'OPEN' });
    assert.equal(crossFiling.status, 404);

    // cross-tenant: Client B admin cannot create an issue (read-only)
    const clientDenied = await api.post(`/api/v1/gst-filings/${h.filingB._id}/issues`).set(bAdmin).send({ type: 'OTHER', title: 'x' });
    assert.equal(clientDenied.status, 403);
  });

  await t.test('issues: invoiceId from another tenant is rejected', async () => {
    const bad = await api.post(`/api/v1/gst-filings/${h.filingB._id}/issues`).set(v).send({ type: 'INVOICE_MISMATCH', title: 'Wrong invoice', invoiceId: String(A.invoice._id) });
    assert.equal(bad.status, 400);
  });

  // ---- reconciliation + readiness ------------------------------------------------------------
  await t.test('reconciliation: known ISSUED/CANCELLED/DRAFT invoices and Tally sync states produce correct counts', async () => {
    const thirdTenant = await h.mkTenant('E');
    const ctxE = thirdTenant.ctx;
    const svc = h.container.services;
    const product = thirdTenant.product;
    const customer = thirdTenant.customer;

    const mk = async (qty) => svc.invoiceService.create(ctxE, {
      customerId: String(customer._id), invoiceDate: new Date('2026-07-10'), gstApplicable: true, items: [{ productId: String(product._id), quantity: qty }],
    });
    const draft = await mk('1');
    const toIssueSynced = await mk('2');
    const toIssueFailed = await mk('3');
    const toIssueUnsynced = await mk('4');
    const toCancel = await mk('5');
    await svc.invoiceService.issue(ctxE, toIssueSynced._id);
    await svc.invoiceService.issue(ctxE, toIssueFailed._id);
    await svc.invoiceService.issue(ctxE, toIssueUnsynced._id);
    await svc.invoiceService.issue(ctxE, toCancel._id);
    await svc.invoiceService.cancel(ctxE, toCancel._id, 'Test cancellation for reconciliation fixture');
    void draft;

    await h.repos.tallySyncs.create(thirdTenant.tenant._id, { invoiceId: String(toIssueSynced._id), status: 'SYNCED', attempt: 1, startedAt: new Date(), completedAt: new Date() });
    await h.repos.tallySyncs.create(thirdTenant.tenant._id, { invoiceId: String(toIssueFailed._id), status: 'FAILED', attempt: 1, startedAt: new Date() });
    // toIssueUnsynced intentionally has no TallySync record at all -> counted as notSynced.

    const filingRes = await api.post('/api/v1/gst-filings').set(adminHeader(thirdTenant.tenant._id)).send({ periodKey: '2026-07', returnType: 'GSTR_1' });
    assert.equal(filingRes.status, 201);
    const detail = await api.get(`/api/v1/gst-filings/${filingRes.body.data._id}`).set(adminHeader(thirdTenant.tenant._id));
    assert.equal(detail.status, 200);
    const { reconciliation, readiness } = detail.body.data;
    assert.equal(reconciliation.total, 5);
    assert.equal(reconciliation.issued, 3);
    assert.equal(reconciliation.cancelled, 1);
    assert.equal(reconciliation.draftExcluded, 1);
    assert.equal(reconciliation.tally.synced, 1);
    assert.equal(reconciliation.tally.failed, 1);
    assert.equal(reconciliation.tally.notSynced, 1);
    assert.ok(readiness.blockers.some((b) => /not Tally-synced/.test(b)));
    assert.equal(readiness.ready, false);
  });

  await t.test('readiness: READY once no open/critical issues and no unsynced invoices; blocked by open critical issue', async () => {
    const thirdTenant = await h.mkTenant('F');
    const ctxF = thirdTenant.ctx;
    const svc = h.container.services;
    const invoice = await svc.invoiceService.create(ctxF, {
      customerId: String(thirdTenant.customer._id), invoiceDate: new Date('2026-08-05'), gstApplicable: true,
      items: [{ productId: String(thirdTenant.product._id), quantity: '1' }],
    });
    await svc.invoiceService.issue(ctxF, invoice._id);
    await h.repos.tallySyncs.create(thirdTenant.tenant._id, { invoiceId: String(invoice._id), status: 'SYNCED', attempt: 1, startedAt: new Date(), completedAt: new Date() });

    const filingRes = await api.post('/api/v1/gst-filings').set(adminHeader(thirdTenant.tenant._id)).send({ periodKey: '2026-08', returnType: 'GSTR_1' });
    const filingId = filingRes.body.data._id;
    const readyFirst = await api.get(`/api/v1/gst-filings/${filingId}`).set(adminHeader(thirdTenant.tenant._id));
    assert.equal(readyFirst.body.data.readiness.ready, true);
    assert.equal(readyFirst.body.data.readiness.label.includes('not a government filing guarantee'), true);

    const issueRes = await api.post(`/api/v1/gst-filings/${filingId}/issues`).set(adminHeader(thirdTenant.tenant._id)).send({ type: 'TAX_CALCULATION', severity: 'CRITICAL', title: 'GST rate mismatch found' });
    assert.equal(issueRes.status, 201);

    const blocked = await api.get(`/api/v1/gst-filings/${filingId}`).set(adminHeader(thirdTenant.tenant._id));
    assert.equal(blocked.body.data.readiness.ready, false);
    assert.ok(blocked.body.data.readiness.blockers.some((b) => /open critical issue/.test(b)));
  });

  // ---- historical integrity ------------------------------------------------------------------
  await t.test('historical integrity: live Customer/Product edits never change an already-issued invoice\'s reconciliation data', async () => {
    const thirdTenant = await h.mkTenant('G');
    const ctxG = thirdTenant.ctx;
    const svc = h.container.services;
    const invoice = await svc.invoiceService.create(ctxG, {
      customerId: String(thirdTenant.customer._id), invoiceDate: new Date('2026-09-05'), gstApplicable: true,
      items: [{ productId: String(thirdTenant.product._id), quantity: '1' }],
    });
    const issued = await svc.invoiceService.issue(ctxG, invoice._id);
    const beforeTotal = issued.grandTotal;

    await svc.productService.update(ctxG, thirdTenant.product._id, { sellingPrice: '999999.00' });
    await svc.customerService.update(ctxG, thirdTenant.customer._id, { name: 'Renamed Customer' });

    const filingRes = await api.post('/api/v1/gst-filings').set(adminHeader(thirdTenant.tenant._id)).send({ periodKey: '2026-09', returnType: 'GSTR_1' });
    const detail = await api.get(`/api/v1/gst-filings/${filingRes.body.data._id}`).set(adminHeader(thirdTenant.tenant._id));
    assert.equal(detail.body.data.reconciliation.issued, 1);
    const refetchInvoice = await api.get(`/api/v1/invoices/${invoice._id}`).set(adminHeader(thirdTenant.tenant._id));
    assert.equal(refetchInvoice.body.data.grandTotal, beforeTotal);
  });

  // ---- RBAC matrix --------------------------------------------------------------------------
  await t.test('RBAC: gst_filings.view is not a CLIENT_USER default (CLIENT_ADMIN only); transitions always denied to client roles; unauthenticated denied', async () => {
    const clientUser = h.bearer((await h.login(A.staff.email)).token);
    assert.equal((await api.get(`/api/v1/gst-filings/${h.filingA._id}`).set(clientUser)).status, 403);
    assert.equal((await api.post(`/api/v1/gst-filings/${h.filingA._id}/start`).set(clientUser)).status, 403);
    assert.equal((await api.get('/api/v1/gst-filings')).status, 401);
    assert.equal((await api.post('/api/v1/gst-filings').send({})).status, 401);
  });
});
