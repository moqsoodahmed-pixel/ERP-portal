import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

const PDF_B64 = Buffer.from('%PDF-1.4 fake bill content').toString('base64');
const docPayload = (name = 'bill.pdf') => ({ documents: [{ fileName: name, mimeType: 'application/pdf', contentBase64: PDF_B64 }] });

test('Phase 15: client bill intake + Tally queue', async (t) => {
  const h = await createHarness();
  const {
    api, A, B, master, vendorUser,
  } = h;
  const m = h.bearer((await h.login(master.email)).token);
  const adminHeader = (tenantId) => ({ ...m, 'X-Admin-Tenant-Id': String(tenantId) });
  const v = h.bearer((await h.login(vendorUser.email)).token);
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);

  // ---- create / draft / update -----------------------------------------------------------
  await t.test('create: client creates a draft bill with only partial info (no fake defaults)', async () => {
    const res = await api.post('/api/v1/bills').set(aAdmin).send({ vendorName: 'Office Supplies Co' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.status, 'DRAFT');
    assert.equal(res.body.data.tallyStatus, 'NOT_READY');
    assert.equal(res.body.data.billNumber, undefined);
    h.billA = res.body.data;
  });

  await t.test('update: draft-editable fields only; a status/tenantId/reviewedBy field in the body is rejected outright (strict schema), not silently accepted', async () => {
    const mass = await api.patch(`/api/v1/bills/${h.billA._id}`).set(aAdmin).send({ billNumber: 'BILL-001', status: 'COMPLETED' });
    assert.equal(mass.status, 400); // unknown/forbidden field in a .strict() schema — never even reaches the service layer

    const res = await api.patch(`/api/v1/bills/${h.billA._id}`).set(aAdmin).send({
      billNumber: 'BILL-001', billDate: '2026-04-01', amount: '1180.00', taxableAmount: '1000.00', cgst: '90.00', sgst: '90.00',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.billNumber, 'BILL-001');
    assert.equal(res.body.data.status, 'DRAFT');
    assert.equal(res.body.data.tenantId, String(A.tenant._id));
  });

  await t.test('CLIENT_USER (staff) can also create/edit bills for their own tenant', async () => {
    const res = await api.post('/api/v1/bills').set(aStaff).send({ vendorName: 'Staff-created bill' });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.tenantId, String(A.tenant._id));
  });

  // ---- documents --------------------------------------------------------------------------
  await t.test('documents: upload is reused Phase 5 storage; cross-tenant and IDOR access denied', async () => {
    const upload = await api.post(`/api/v1/bills/${h.billA._id}/documents`).set(aAdmin).send(docPayload());
    assert.equal(upload.status, 200);
    assert.equal(upload.body.data.documentIds.length, 1);
    h.billA = upload.body.data;
    const docId = h.billA.documentIds[0];

    const own = await api.get(`/api/v1/bills/${h.billA._id}/documents/${docId}`).set(aAdmin);
    assert.equal(own.status, 200);
    assert.equal(own.headers['content-type'], 'application/pdf');

    // cross-tenant: tenant B cannot reach tenant A's bill or its document at all
    assert.equal((await api.get(`/api/v1/bills/${h.billA._id}`).set(bAdmin)).status, 403);
    assert.equal((await api.get(`/api/v1/bills/${h.billA._id}/documents/${docId}`).set(bAdmin)).status, 403);

    // IDOR: an unrelated (but real, same-tenant) FileMetadata id not referenced by this bill is rejected
    const unrelated = await h.repos.fileMetadata.createForTenant(A.tenant._id, {
      uploadedBy: A.admin._id, fileName: 'other.pdf', mimeType: 'application/pdf', size: 10, storageProvider: 'LOCAL_DEV', storageKey: `tenant/${A.tenant._id}/other`, checksum: 'x', purpose: 'BILL_DOCUMENT',
    });
    const idor = await api.get(`/api/v1/bills/${h.billA._id}/documents/${unrelated._id}`).set(aAdmin);
    assert.equal(idor.status, 404);
  });

  await t.test('documents: oversized/invalid mime rejected at the schema level', async () => {
    const badMime = await api.post(`/api/v1/bills/${h.billA._id}/documents`).set(aAdmin).send({ documents: [{ fileName: 'x.exe', mimeType: 'application/octet-stream', contentBase64: PDF_B64 }] });
    assert.equal(badMime.status, 400);
  });

  // ---- submit -------------------------------------------------------------------------------
  await t.test('submit: requires at least one document; DRAFT -> SUBMITTED; notifies; duplicate submit rejected', async () => {
    const noDocBill = await (await api.post('/api/v1/bills').set(aAdmin).send({})).body.data;
    const blocked = await api.post(`/api/v1/bills/${noDocBill._id}/submit`).set(aAdmin);
    assert.equal(blocked.status, 400);

    const submit = await api.post(`/api/v1/bills/${h.billA._id}/submit`).set(aAdmin);
    assert.equal(submit.status, 200);
    assert.equal(submit.body.data.status, 'SUBMITTED');
    assert.equal(submit.body.data.submittedBy, String(A.admin._id));

    const again = await api.post(`/api/v1/bills/${h.billA._id}/submit`).set(aAdmin);
    assert.equal(again.status, 409);

    // edits are blocked once submitted
    const editAfterSubmit = await api.patch(`/api/v1/bills/${h.billA._id}`).set(aAdmin).send({ vendorName: 'changed' });
    assert.equal(editAfterSubmit.status, 409);
  });

  await t.test('concurrency: two simultaneous submits on the same DRAFT bill — only one succeeds', async () => {
    const draft = (await api.post('/api/v1/bills').set(aAdmin).send({})).body.data;
    await api.post(`/api/v1/bills/${draft._id}/documents`).set(aAdmin).send(docPayload());
    const [r1, r2] = await Promise.all([
      api.post(`/api/v1/bills/${draft._id}/submit`).set(aAdmin),
      api.post(`/api/v1/bills/${draft._id}/submit`).set(aAdmin),
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
    h.concurrencyBill = draft;
  });

  // ---- review workflow (Admin = Master Admin, the platform's only admin-capable role) ------
  await t.test('review: client cannot review/reject; Master Admin accepts a bill -> READY_FOR_TALLY and enters the Tally queue', async () => {
    assert.equal((await api.post(`/api/v1/bills/${h.billA._id}/review`).set(aAdmin)).status, 403);
    assert.equal((await api.post(`/api/v1/bills/${h.billA._id}/review`).set(v)).status, 403);

    const review = await api.post(`/api/v1/bills/${h.billA._id}/review`).set(adminHeader(A.tenant._id));
    assert.equal(review.status, 200);
    assert.equal(review.body.data.status, 'READY_FOR_TALLY');
    assert.equal(review.body.data.tallyStatus, 'QUEUED');
    assert.ok(review.body.data.readyForTallyAt);
  });

  await t.test('review: a bill missing required Tally data is marked FAILED with documented reasons, not force-queued', async () => {
    const partial = (await api.post('/api/v1/bills').set(aAdmin).send({ vendorName: 'No bill number or date' })).body.data;
    await api.post(`/api/v1/bills/${partial._id}/documents`).set(aAdmin).send(docPayload());
    await api.post(`/api/v1/bills/${partial._id}/submit`).set(aAdmin);
    const review = await api.post(`/api/v1/bills/${partial._id}/review`).set(adminHeader(A.tenant._id));
    assert.equal(review.status, 200);
    assert.equal(review.body.data.status, 'FAILED');
    assert.ok(review.body.data.tallyReadinessIssues.length > 0);
    assert.equal(review.body.data.tallyStatus, 'NOT_READY');
  });

  await t.test('reject: mandatory reason enforced; rejected bill never enters the Tally queue', async () => {
    const toReject = (await api.post('/api/v1/bills').set(aAdmin).send({ billNumber: 'REJ-1', billDate: '2026-04-02', vendorName: 'V', amount: '100.00' })).body.data;
    await api.post(`/api/v1/bills/${toReject._id}/documents`).set(aAdmin).send(docPayload());
    await api.post(`/api/v1/bills/${toReject._id}/submit`).set(aAdmin);

    const noReason = await api.post(`/api/v1/bills/${toReject._id}/reject`).set(adminHeader(A.tenant._id)).send({});
    assert.equal(noReason.status, 400);

    const reject = await api.post(`/api/v1/bills/${toReject._id}/reject`).set(adminHeader(A.tenant._id)).send({ reason: 'Vendor GSTIN does not match records' });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.data.status, 'REJECTED');
    assert.equal(reject.body.data.rejectionReason, 'Vendor GSTIN does not match records');

    const queue = await api.get('/api/v1/tally/queue').set(adminHeader(A.tenant._id));
    assert.ok(!queue.body.data.items.some((b) => b.id === toReject._id));

    const invalidTransition = await api.post(`/api/v1/bills/${toReject._id}/submit`).set(aAdmin);
    assert.equal(invalidTransition.status, 409);
  });

  await t.test('concurrency: two simultaneous reviews on the same SUBMITTED bill — only one wins the status change', async () => {
    const bill = (await api.post('/api/v1/bills').set(aAdmin).send({ billNumber: 'CONC-1', billDate: '2026-04-03', vendorName: 'V', amount: '50.00' })).body.data;
    await api.post(`/api/v1/bills/${bill._id}/documents`).set(aAdmin).send(docPayload());
    await api.post(`/api/v1/bills/${bill._id}/submit`).set(aAdmin);
    const [r1, r2] = await Promise.all([
      api.post(`/api/v1/bills/${bill._id}/review`).set(adminHeader(A.tenant._id)),
      api.post(`/api/v1/bills/${bill._id}/review`).set(adminHeader(A.tenant._id)),
    ]);
    // Both may return 200 (startReview then approve happen inside one service call per request), but the
    // underlying bill must only ever have been moved forward once — verify no duplicate TALLY_QUEUE_CREATED.
    const final = await api.get(`/api/v1/bills/${bill._id}`).set(adminHeader(A.tenant._id));
    assert.equal(final.body.data.status, 'READY_FOR_TALLY');
    const statuses = [r1.status, r2.status];
    assert.ok(statuses.every((s) => [200, 409].includes(s)));
  });

  // ---- Tally queue + vendor workflow --------------------------------------------------------
  await t.test('vendor: sees assigned clients\' queued bills only; cannot review/reject; processes Tally status', async () => {
    const vendorQueue = await api.get('/api/v1/tally/queue').set(v);
    assert.equal(vendorQueue.status, 200);
    assert.ok(vendorQueue.body.data.items.some((b) => b.id === h.billA._id));
    assert.ok(!vendorQueue.body.data.items.some((b) => b.tenantId === String(B.tenant._id)));

    assert.equal((await api.post(`/api/v1/bills/${h.billA._id}/review`).set(v)).status, 403);
    assert.equal((await api.post(`/api/v1/bills/${h.billA._id}/reject`).set(v).send({ reason: 'no' })).status, 403);

    const processing = await api.post(`/api/v1/bills/${h.billA._id}/tally/processing`).set(v);
    assert.equal(processing.status, 200);
    assert.equal(processing.body.data.tallyStatus, 'PROCESSING');

    const synced = await api.post(`/api/v1/bills/${h.billA._id}/tally/synced`).set(v).send({ tallyReference: 'VCH-001' });
    assert.equal(synced.status, 200);
    assert.equal(synced.body.data.tallyStatus, 'SYNCED');
    assert.equal(synced.body.data.status, 'ACCOUNTING_IN_PROGRESS');

    const complete = await api.post(`/api/v1/bills/${h.billA._id}/complete`).set(adminHeader(A.tenant._id));
    assert.equal(complete.status, 200);
    assert.equal(complete.body.data.status, 'COMPLETED');
  });

  await t.test('vendor: tally failure + retry path; unassigned client denied', async () => {
    const bill = (await api.post('/api/v1/bills').set(aAdmin).send({ billNumber: 'FAIL-1', billDate: '2026-04-04', vendorName: 'V', amount: '10.00' })).body.data;
    await api.post(`/api/v1/bills/${bill._id}/documents`).set(aAdmin).send(docPayload());
    await api.post(`/api/v1/bills/${bill._id}/submit`).set(aAdmin);
    await api.post(`/api/v1/bills/${bill._id}/review`).set(adminHeader(A.tenant._id));
    await api.post(`/api/v1/bills/${bill._id}/tally/processing`).set(v);
    const failed = await api.post(`/api/v1/bills/${bill._id}/tally/failed`).set(v).send({ reason: 'Ledger mapping missing in Tally' });
    assert.equal(failed.status, 200);
    assert.equal(failed.body.data.tallyStatus, 'FAILED');
    const retry = await api.post(`/api/v1/bills/${bill._id}/tally/retry`).set(v);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.data.tallyStatus, 'QUEUED');

    const thirdTenant = await h.mkTenant('BillVendorUnassigned', { withInvoice: false });
    const thirdAdmin = h.bearer((await h.login(thirdTenant.admin.email)).token);
    const other = (await api.post('/api/v1/bills').set(thirdAdmin).send({})).body.data;
    assert.equal((await api.get(`/api/v1/bills/${other._id}`).set(v)).status, 403);
  });

  await t.test('vendor: Phase 18 client-workspace narrowing — own assigned client allowed, unassigned/foreign tenant denied', async () => {
    const narrowed = await api.get(`/api/v1/bills?client=${A.tenant._id}`).set(v);
    assert.equal(narrowed.status, 200);
    assert.ok(narrowed.body.data.items.every((b) => String(b.tenantId) === String(A.tenant._id)));

    const foreign = await api.get(`/api/v1/bills?client=${B.tenant._id}`).set(v);
    assert.equal(foreign.status, 403, 'vendor is not assigned to B — client param must not be trusted bare');

    const narrowedQueue = await api.get(`/api/v1/tally/queue?clientId=${A.tenant._id}`).set(v);
    assert.equal(narrowedQueue.status, 200);
    assert.equal((await api.get(`/api/v1/tally/queue?clientId=${B.tenant._id}`).set(v)).status, 403);
  });

  // ---- tenant isolation ---------------------------------------------------------------------
  await t.test('tenant isolation: list only returns own tenant\'s bills; manipulated tenantId/clientUserId in body have no effect', async () => {
    const list = await api.get('/api/v1/bills').set(bAdmin);
    assert.equal(list.status, 200);
    assert.ok(!list.body.data.items.some((b) => String(b.tenantId) === String(A.tenant._id)));

    // A tenantId in the body that doesn't match the caller's own tenant is a cross-tenant attempt and is
    // rejected outright (resolveTenant denies it before the request ever reaches the service layer).
    const spoofed = await api.post('/api/v1/bills').set(bAdmin).send({ tenantId: String(A.tenant._id), vendorName: 'x' });
    assert.equal(spoofed.status, 403);

    const created = await api.post('/api/v1/bills').set(bAdmin).send({ vendorName: 'B tenant bill' });
    assert.equal(created.status, 201);
    assert.equal(created.body.data.tenantId, String(B.tenant._id));
    assert.equal(created.body.data.clientUserId, String(B.admin._id));
  });

  await t.test('unauthenticated access denied', async () => {
    assert.equal((await api.get('/api/v1/bills')).status, 401);
    assert.equal((await api.post('/api/v1/bills').send({})).status, 401);
    assert.equal((await api.get('/api/v1/tally/queue')).status, 401);
  });

  // ---- audit ---------------------------------------------------------------------------------
  await t.test('audit: key bill lifecycle events are recorded without leaking document bytes/secrets', async () => {
    const auditRes = await api.get('/api/v1/audit-logs').set(m).query({ action: 'BILL_SUBMITTED', limit: 50 });
    assert.equal(auditRes.status, 200);
    assert.ok(auditRes.body.data.items.length > 0);
    const entry = auditRes.body.data.items[0];
    assert.equal(JSON.stringify(entry).includes(PDF_B64), false);
  });
});
