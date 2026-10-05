import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

const PDF_B64 = Buffer.from('%PDF-1.4 fake bill content').toString('base64');
const docPayload = (name = 'bill.pdf') => ({ documents: [{ fileName: name, mimeType: 'application/pdf', contentBase64: PDF_B64 }] });

/** Drives a bill all the way to READY_FOR_TALLY (tallyStatus QUEUED), which is the trigger for TallyJob creation. */
async function makeReadyBill(api, adminHeader, tenant, clientAuth, { billNumber = 'BILL-001' } = {}) {
  const created = await api.post('/api/v1/bills').set(clientAuth).send({ vendorName: 'Acme Supplies' });
  const bill = created.body.data;
  await api.post(`/api/v1/bills/${bill._id}/documents`).set(clientAuth).send(docPayload());
  await api.patch(`/api/v1/bills/${bill._id}`).set(clientAuth).send({
    billNumber, billDate: '2026-04-01', amount: '1180.00', taxableAmount: '1000.00', cgst: '90.00', sgst: '90.00',
  });
  await api.post(`/api/v1/bills/${bill._id}/submit`).set(clientAuth);
  const review = await api.post(`/api/v1/bills/${bill._id}/review`).set(adminHeader(tenant._id));
  assert.equal(review.status, 200);
  assert.equal(review.body.data.tallyStatus, 'QUEUED');
  return review.body.data;
}

test('Phase 16: Tally Connector bridge (auth, tenant isolation, job lifecycle, concurrency, idempotency, security)', async (t) => {
  const h = await createHarness();
  const {
    api, A, B, master,
  } = h;
  const m = h.bearer((await h.login(master.email)).token);
  const adminHeader = (tenantId) => ({ ...m, 'X-Admin-Tenant-Id': String(tenantId) });
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);

  // Company binding (spec Step 15) requires a configured TallyIntegration BEFORE connector registration —
  // registration copies the tenant's current companyName/companyGuid onto the connector record.
  await api.post('/api/v1/tally/config').set(aAdmin).send({
    enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://127.0.0.1:9', companyName: 'A Tally Co',
    defaultVoucherType: 'Sales', salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST',
  });
  await api.post('/api/v1/tally/config').set(bAdmin).send({
    enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://127.0.0.1:9', companyName: 'B Tally Co',
    defaultVoucherType: 'Sales', salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST',
  });

  let secretA;
  let connectorIdA;

  await t.test('REGISTRATION: Client Admin registers a connector; raw secret returned once, never again', async () => {
    const res = await api.post('/api/v1/tally/connectors').set(aAdmin).send({ name: 'Warehouse PC' });
    assert.equal(res.status, 201);
    assert.match(res.body.data.connectorSecret, /^tconn_live_/);
    assert.equal(res.body.data.status, 'ACTIVE');
    assert.deepEqual(res.body.data.scopes.sort(), ['tally:connector:heartbeat', 'tally:connector:poll', 'tally:connector:submit'].sort());
    secretA = res.body.data.connectorSecret;
    connectorIdA = res.body.data.id;

    const list = await api.get('/api/v1/tally/connectors').set(aAdmin);
    const text = JSON.stringify(list.body);
    assert.ok(!text.includes(secretA.slice(12)), 'raw secret must never reappear in list');
    assert.ok(!text.includes('secretHash'));
  });

  await t.test('REGISTRATION: CLIENT_USER (staff) cannot manage connectors (no permission)', async () => {
    assert.equal((await api.get('/api/v1/tally/connectors').set(aStaff)).status, 403);
    assert.equal((await api.post('/api/v1/tally/connectors').set(aStaff).send({ name: 'x' })).status, 403);
  });

  await t.test('AUTH: valid connector secret authenticates; missing/malformed/unknown get one generic failure', async () => {
    const ok = await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', secretA);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.id, connectorIdA);

    const missing = await api.get('/api/v1/tally/connector/status');
    const malformed = await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', 'not-a-secret');
    const unknown = await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', `tconn_live_${'a'.repeat(43)}`);
    for (const res of [missing, malformed, unknown]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'TALLY_CONNECTOR_INVALID');
    }
    assert.deepEqual(missing.body.error, malformed.body.error);
    assert.deepEqual(missing.body.error, unknown.body.error);
  });

  await t.test('AUTH: a connector secret cannot be used as a Tally Public API key or vice versa', async () => {
    const asPublicApi = await api.get('/api/v1/tally/public/company').set('X-Tally-API-Key', secretA);
    assert.equal(asPublicApi.status, 401);
  });

  let billA1;
  await t.test('JOB CREATION: a bill reaching READY_FOR_TALLY creates exactly one TallyJob (QUEUED)', async () => {
    billA1 = await makeReadyBill(api, adminHeader, A.tenant, aAdmin, { billNumber: 'BILL-J1' });
    const jobs = h.fake.TallyJob.docs.filter((j) => String(j.billIntakeId) === String(billA1._id));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].status, 'QUEUED');
    assert.equal(jobs[0].type, 'SYNC_BILL_TO_TALLY');
  });

  await t.test('IDEMPOTENCY: retrying the review / re-approving an already-queued bill never creates a second job', async () => {
    const before = h.fake.TallyJob.docs.filter((j) => String(j.billIntakeId) === String(billA1._id)).length;
    // review() on an already-READY_FOR_TALLY bill is rejected by the Phase 15 state machine (409) — but even
    // if the hook were invoked twice concurrently, createForBill()'s duplicate-key handling makes it a no-op.
    const again = await api.post(`/api/v1/bills/${billA1._id}/review`).set(adminHeader(A.tenant._id));
    assert.equal(again.status, 409);
    const after = h.fake.TallyJob.docs.filter((j) => String(j.billIntakeId) === String(billA1._id)).length;
    assert.equal(after, before);
  });

  await t.test('POLLING: connector sees only its own tenant\'s claimable jobs; a manipulated tenant filter has no effect', async () => {
    const res = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA).query({ tenantId: String(B.tenant._id) });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.some((j) => String(j.billIntakeId) === String(billA1._id)));
    assert.ok(res.body.data.every((j) => j.type === 'SYNC_BILL_TO_TALLY'));
  });

  let jobIdA1;
  await t.test('CLAIMING: atomic — two simultaneous claims on the same job, exactly one wins', async () => {
    const res2 = await api.post('/api/v1/tally/connectors').set(aAdmin).send({ name: 'Second Machine' });
    const secretA2 = res2.body.data.connectorSecret;
    const jobs = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA);
    const job = jobs.body.data.find((j) => String(j.billIntakeId) === String(billA1._id));
    jobIdA1 = job.id;
    const [c1, c2] = await Promise.all([
      api.post(`/api/v1/tally/connector/jobs/${jobIdA1}/claim`).set('X-Tally-Connector-Secret', secretA),
      api.post(`/api/v1/tally/connector/jobs/${jobIdA1}/claim`).set('X-Tally-Connector-Secret', secretA2),
    ]);
    const statuses = [c1.status, c2.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    const winner = c1.status === 200 ? c1 : c2;
    assert.ok(winner.body.data.payload);
    assert.equal(winner.body.data.payload.billIntakeId, String(billA1._id));
    // Payload never includes Tally credentials/unrelated data — only the bounded bill summary fields.
    assert.ok(!('authPasswordEncrypted' in winner.body.data.payload));
    const jobDoc = h.fake.TallyJob.docs.find((j) => j._id === jobIdA1);
    assert.equal(jobDoc.status, 'PROCESSING');
    assert.equal(h.fake.AuditLog.docs.filter((d) => d.action === 'TALLY_JOB_CLAIM_CONFLICT').length >= 1, true);
  });

  await t.test('RESULT: duplicate result reports / claims after SUCCEEDED are rejected (no reversal, spec Step 17)', async () => {
    const result = await api.post(`/api/v1/tally/connector/jobs/${jobIdA1}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'SUCCEEDED', tallyReference: 'VCH-0001' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, 'SUCCEEDED');

    const billAfter = (await api.get(`/api/v1/bills/${billA1._id}`).set(aAdmin)).body.data;
    assert.equal(billAfter.tallyStatus, 'SYNCED');
    assert.equal(billAfter.tallyReference, 'VCH-0001');

    const dup = await api.post(`/api/v1/tally/connector/jobs/${jobIdA1}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'SUCCEEDED', tallyReference: 'VCH-0002' });
    assert.equal(dup.status, 409);
    const reClaim = await api.post(`/api/v1/tally/connector/jobs/${jobIdA1}/claim`).set('X-Tally-Connector-Secret', secretA);
    assert.equal(reClaim.status, 409);
  });

  let billA2;
  let jobIdA2;
  await t.test('RETRY: a transient failure (TALLY_TIMEOUT) is retried automatically back to QUEUED', async () => {
    billA2 = await makeReadyBill(api, adminHeader, A.tenant, aAdmin, { billNumber: 'BILL-J2' });
    const jobs = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA);
    const job = jobs.body.data.find((j) => String(j.billIntakeId) === String(billA2._id));
    jobIdA2 = job.id;
    await api.post(`/api/v1/tally/connector/jobs/${jobIdA2}/claim`).set('X-Tally-Connector-Secret', secretA);
    const failed = await api.post(`/api/v1/tally/connector/jobs/${jobIdA2}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'FAILED', errorCode: 'TALLY_TIMEOUT', message: 'connection timed out' });
    assert.equal(failed.status, 200);
    const jobDoc = h.fake.TallyJob.docs.find((j) => j._id === jobIdA2);
    assert.equal(jobDoc.status, 'QUEUED');
    assert.equal(jobDoc.attempts, 1);
    assert.ok(new Date(jobDoc.availableAt).getTime() > Date.now());
  });

  await t.test('RETRY: a permanent failure (TALLY_REJECTED) is NOT auto-retried; bill surfaces FAILED', async () => {
    const billA3 = await makeReadyBill(api, adminHeader, A.tenant, aAdmin, { billNumber: 'BILL-J3' });
    const jobs = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA);
    const job = jobs.body.data.find((j) => String(j.billIntakeId) === String(billA3._id));
    await api.post(`/api/v1/tally/connector/jobs/${job.id}/claim`).set('X-Tally-Connector-Secret', secretA);
    const failed = await api.post(`/api/v1/tally/connector/jobs/${job.id}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'FAILED', errorCode: 'TALLY_REJECTED', message: 'voucher rejected' });
    assert.equal(failed.status, 200);
    const jobDoc = h.fake.TallyJob.docs.find((j) => j._id === job.id);
    assert.equal(jobDoc.status, 'FAILED');
    const billAfter = (await api.get(`/api/v1/bills/${billA3._id}`).set(aAdmin)).body.data;
    assert.equal(billAfter.tallyStatus, 'FAILED');
  });

  await t.test('IDEMPOTENCY: a late SUCCEEDED result arriving after the job was already retried is rejected, not double-applied', async () => {
    // Simulates "network timeout after Tally accepted the voucher": the connector's result POST is lost in
    // transit, the job gets auto-retried back to QUEUED (as in the RETRY test above), and THEN the original
    // connector's delayed/duplicate result finally arrives. The conditional (status-guarded) update in
    // tallyJobRepo.succeed() must refuse it — the job is no longer PROCESSING under that connector's claim —
    // so there is no duplicate "synced" bill-status flip and no duplicate tallyReference.
    const billLate = await makeReadyBill(api, adminHeader, A.tenant, aAdmin, { billNumber: 'BILL-LATE-1' });
    const jobsList = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA);
    const jobLate = jobsList.body.data.find((j) => String(j.billIntakeId) === String(billLate._id));
    await api.post(`/api/v1/tally/connector/jobs/${jobLate.id}/claim`).set('X-Tally-Connector-Secret', secretA);

    // The job is retried (transient failure) — this is what would also happen if the ERP side independently
    // re-queued after not hearing back in time.
    const retried = await api.post(`/api/v1/tally/connector/jobs/${jobLate.id}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'FAILED', errorCode: 'TALLY_TIMEOUT', message: 'connection timed out' });
    assert.equal(retried.status, 200);
    const jobDocAfterRetry = h.fake.TallyJob.docs.find((j) => j._id === jobLate.id);
    assert.equal(jobDocAfterRetry.status, 'QUEUED');

    // Now the ORIGINAL (stale) connector attempt's success report finally arrives — Tally actually accepted
    // the voucher before the timeout was reported, so this is exactly the "accepted but we didn't hear back
    // in time" race the spec asks to guard against.
    const lateResult = await api.post(`/api/v1/tally/connector/jobs/${jobLate.id}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'SUCCEEDED', tallyReference: 'VCH-LATE-STALE' });
    assert.equal(lateResult.status, 409, 'a result for a job no longer in PROCESSING under this claim must be rejected, not accepted');

    const jobDocFinal = h.fake.TallyJob.docs.find((j) => j._id === jobLate.id);
    assert.equal(jobDocFinal.status, 'QUEUED', 'job state was not corrupted by the late/duplicate result');
    assert.notEqual(jobDocFinal.tallyReference, 'VCH-LATE-STALE');
    const billAfterLate = (await api.get(`/api/v1/bills/${billLate._id}`).set(aAdmin)).body.data;
    assert.notEqual(billAfterLate.tallyStatus, 'SYNCED', 'bill must not be marked synced from a stale duplicate result');

    // And no duplicate voucher-intent/sync-log-equivalent record was created: exactly one TallyJob still
    // exists for this bill (the unique tenantId+billIntakeId+type index already enforced this at creation,
    // this just confirms the result-reporting path doesn't create a second one on the side).
    const jobsForBill = h.fake.TallyJob.docs.filter((j) => String(j.billIntakeId) === String(billLate._id));
    assert.equal(jobsForBill.length, 1);
  });

  await t.test('COMPANY MISMATCH: connector bound to a DIFFERENT company name than the tenant currently has configured fails safely (no voucher posted)', async () => {
    // Distinguishes from the "never configured / null" COMPANY BINDING test below: here the connector DOES
    // have a company identity, it simply no longer matches the tenant's current TallyIntegration (e.g. the
    // admin repointed Tally at a different company after the connector was registered, or — the scenario this
    // test is really guarding — a connector's stored binding looks like it belongs to a different tenant's
    // company altogether).
    const res = await api.post('/api/v1/tally/connectors').set(bAdmin).send({ name: 'Mismatched machine' });
    const doc = h.fake.TallyConnector.docs.find((d) => d._id === res.body.data.id);
    const originalCompany = doc.tallyCompanyName;
    doc.tallyCompanyName = 'A Tally Co'; // looks like tenant A's company, not tenant B's configured one
    assert.notEqual(originalCompany, doc.tallyCompanyName);

    const billMismatch = await makeReadyBill(api, adminHeader, B.tenant, bAdmin, { billNumber: 'B-BILL-MISMATCH' });
    const jobMismatch = h.fake.TallyJob.docs.find((j) => String(j.billIntakeId) === String(billMismatch._id));
    const claim = await api.post(`/api/v1/tally/connector/jobs/${jobMismatch._id}/claim`).set('X-Tally-Connector-Secret', res.body.data.connectorSecret);
    assert.equal(claim.status, 409);
    assert.equal(claim.body.error.code, 'TALLY_COMPANY_BINDING_UNVERIFIED');

    // The job is failed safely (not left dangling in PROCESSING, not silently dropped), with a clear
    // classification, and no voucher payload was ever handed to the connector.
    const jobDoc = h.fake.TallyJob.docs.find((j) => j._id === jobMismatch._id);
    assert.equal(jobDoc.status, 'FAILED');
    assert.equal(jobDoc.lastErrorCode, 'TALLY_MAPPING_MISSING');
    assert.ok(!claim.body.data?.payload, 'no voucher payload was ever returned for a company-mismatched connector');
  });

  await t.test('TENANT ISOLATION: connector A cannot claim or see tenant B jobs even by guessing a job id', async () => {
    const billB1 = await makeReadyBill(api, adminHeader, B.tenant, bAdmin, { billNumber: 'B-BILL-1' });
    const jobB = h.fake.TallyJob.docs.find((j) => String(j.billIntakeId) === String(billB1._id));
    const crossClaim = await api.post(`/api/v1/tally/connector/jobs/${jobB._id}/claim`).set('X-Tally-Connector-Secret', secretA);
    assert.equal(crossClaim.status, 409); // tenant-scoped query simply finds nothing to claim — never a 200
    const crossResult = await api.post(`/api/v1/tally/connector/jobs/${jobB._id}/result`).set('X-Tally-Connector-Secret', secretA)
      .send({ status: 'SUCCEEDED', tallyReference: 'X' });
    assert.equal(crossResult.status, 404); // not even visible to connector A's tenant-scoped lookup
    const listA = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', secretA);
    assert.ok(!listA.body.data.some((j) => String(j.billIntakeId) === String(billB1._id)));
  });

  await t.test('COMPANY BINDING: a connector registered before Tally integration exists fails safely rather than guessing a company', async () => {
    const res = await api.post('/api/v1/tally/connectors').set(bAdmin).send({ name: 'Unbound machine' });
    // force-clear the company binding to simulate a stale/never-configured connector
    const doc = h.fake.TallyConnector.docs.find((d) => d._id === res.body.data.id);
    doc.tallyCompanyName = null;
    const billB2 = await makeReadyBill(api, adminHeader, B.tenant, bAdmin, { billNumber: 'B-BILL-2' });
    const jobB2 = h.fake.TallyJob.docs.find((j) => String(j.billIntakeId) === String(billB2._id));
    const claim = await api.post(`/api/v1/tally/connector/jobs/${jobB2._id}/claim`).set('X-Tally-Connector-Secret', res.body.data.connectorSecret);
    assert.equal(claim.status, 409);
    assert.equal(claim.body.error.code, 'TALLY_COMPANY_BINDING_UNVERIFIED');
  });

  await t.test('HEARTBEAT: updates lastHeartbeatAt/lastPollAt and is throttled against a write storm', async () => {
    const hb1 = await api.post('/api/v1/tally/connector/heartbeat').set('X-Tally-Connector-Secret', secretA).send({ version: '1.0.0', tallyAvailable: true });
    assert.equal(hb1.status, 200);
    assert.equal(hb1.body.data.throttled, false);
    const hb2 = await api.post('/api/v1/tally/connector/heartbeat').set('X-Tally-Connector-Secret', secretA).send({ version: '1.0.0', tallyAvailable: true });
    assert.equal(hb2.body.data.throttled, true);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_CONNECTOR_HEARTBEAT'));
  });

  await t.test('SCOPES: a connector always has all three minimal scopes, never arbitrary ERP permissions', async () => {
    const status = await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', secretA);
    assert.deepEqual(status.body.data.scopes.sort(), ['tally:connector:heartbeat', 'tally:connector:poll', 'tally:connector:submit'].sort());
  });

  await t.test('LIFECYCLE: revoke makes the connector secret fail auth immediately', async () => {
    const revoked = await api.post(`/api/v1/tally/connectors/${connectorIdA}/revoke`).set(aAdmin);
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.status, 'REVOKED');
    assert.equal((await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', secretA)).status, 401);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_CONNECTOR_REVOKED'));
  });

  await t.test('LIFECYCLE: rotate issues a new secret; the old one stops working, the new one works', async () => {
    const created = await api.post('/api/v1/tally/connectors').set(aAdmin).send({ name: 'to-rotate' });
    const oldSecret = created.body.data.connectorSecret;
    const rotated = await api.post(`/api/v1/tally/connectors/${created.body.data.id}/rotate`).set(aAdmin);
    assert.equal(rotated.status, 200);
    const newSecret = rotated.body.data.connectorSecret;
    assert.notEqual(newSecret, oldSecret);
    assert.equal((await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', oldSecret)).status, 401);
    assert.equal((await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', newSecret)).status, 200);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'TALLY_CONNECTOR_ROTATED'));
  });

  await t.test('response security: management endpoints never leak another tenant\'s connectors', async () => {
    const bConn = await api.post('/api/v1/tally/connectors').set(bAdmin).send({ name: 'tenant-b-connector' });
    const aList = await api.get('/api/v1/tally/connectors').set(aAdmin);
    assert.ok(!aList.body.data.some((c) => c.id === bConn.body.data.id));
    const crossGet = await api.get(`/api/v1/tally/connectors/${bConn.body.data.id}`).set(aAdmin);
    assert.equal(crossGet.status, 404);
  });

  await t.test('RATE LIMITING: the connector API has its own per-connector limiter, independent of the general ERP limiter', async () => {
    const limited = await createHarness({ rateLimits: { tallyConnector: { windowMs: 60_000, max: 2 } } });
    const limitedAdmin = limited.bearer((await limited.login(limited.A.admin.email)).token);
    await limited.api.post('/api/v1/tally/config').set(limitedAdmin).send({
      enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://127.0.0.1:9', companyName: 'Co',
      defaultVoucherType: 'Sales', salesLedger: 'Sales', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST',
    });
    const created = await limited.api.post('/api/v1/tally/connectors').set(limitedAdmin).send({ name: 'rl' });
    const secret = created.body.data.connectorSecret;
    const codes = [];
    for (let i = 0; i < 4; i += 1) codes.push((await limited.api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', secret)).status);
    assert.deepEqual(codes, [200, 200, 429, 429]);
  });

  await t.test('MASS ASSIGNMENT: a result body cannot set arbitrary job fields or an unsupported status', async () => {
    // secretA was revoked by the LIFECYCLE test above — register a fresh connector for this check.
    const freshConn = await api.post('/api/v1/tally/connectors').set(aAdmin).send({ name: 'mass-assignment-check' });
    const freshSecret = freshConn.body.data.connectorSecret;
    const billA4 = await makeReadyBill(api, adminHeader, A.tenant, aAdmin, { billNumber: 'BILL-J4' });
    const jobs = await api.get('/api/v1/tally/connector/jobs').set('X-Tally-Connector-Secret', freshSecret);
    const job = jobs.body.data.find((j) => String(j.billIntakeId) === String(billA4._id));
    await api.post(`/api/v1/tally/connector/jobs/${job.id}/claim`).set('X-Tally-Connector-Secret', freshSecret);
    const bad = await api.post(`/api/v1/tally/connector/jobs/${job.id}/result`).set('X-Tally-Connector-Secret', freshSecret)
      .send({ status: 'DONE_AND_PAID', attempts: 999 });
    assert.equal(bad.status, 400);
  });

  await t.test('LOGGING: the connector secret header is never written to audit metadata on auth failure', async () => {
    await api.get('/api/v1/tally/connector/status').set('X-Tally-Connector-Secret', 'tconn_live_' + 'b'.repeat(43));
    const authFailureAudit = h.fake.AuditLog.docs.find((d) => d.action === 'TALLY_CONNECTOR_AUTH_FAILED');
    if (authFailureAudit) assert.ok(!JSON.stringify(authFailureAudit).includes('tconn_live_'.padEnd(20, 'b')));
  });
});
