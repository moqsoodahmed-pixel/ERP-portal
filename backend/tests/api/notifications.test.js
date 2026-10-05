import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness, PASSWORD } from '../helpers/harness.js';

test('Phase 9: notifications — generation from service events, idempotency, recipient ownership, API', async (t) => {
  const h = await createHarness();
  const { api, A, B, master, vendor, vendorUser, repos, services, fake } = h;
  const { hashPassword } = await import('../../src/security/password.js');
  const m = h.bearer((await h.login(master.email)).token);
  const mA = { ...m, 'X-Admin-Tenant-Id': String(A.tenant._id) };
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const v = h.bearer((await h.login(vendorUser.email)).token);

  // A second ACTIVE client admin (multi-admin fan-out) and an INACTIVE one (must never receive anything).
  const passwordHash = await hashPassword(PASSWORD);
  const admin2 = await repos.users.createUnscoped({ tenantId: A.tenant._id, name: 'A admin2', email: 'admin2.a@example.test', passwordHash, role: 'CLIENT_ADMIN', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0 });
  const inactiveAdmin = await repos.users.createUnscoped({ tenantId: A.tenant._id, name: 'A old admin', email: 'old.a@example.test', passwordHash, role: 'CLIENT_ADMIN', status: 'INACTIVE', tokenVersion: 0, failedLoginAttempts: 0 });
  const a2 = h.bearer((await h.login(admin2.email)).token);

  const docs = (filter = {}) => fake.Notification.docs.filter((d) => Object.entries(filter).every(([k, val]) => String(d[k]) === String(val)));
  const forUser = (u, type) => docs({ recipientUserId: u._id, ...(type ? { type } : {}) });

  // ------------------------------------------------------------------ generation
  await t.test('INVOICE_ISSUED: every ACTIVE CLIENT_ADMIN of the tenant (not staff, not inactive, not other tenants)', async () => {
    const res = await api.post(`/api/v1/invoices/${A.invoice._id}/issue`).set(aAdmin);
    assert.equal(res.status, 200);
    assert.equal(forUser(A.admin, 'INVOICE_ISSUED').length, 1);
    assert.equal(forUser(admin2, 'INVOICE_ISSUED').length, 1);
    assert.equal(forUser(inactiveAdmin).length, 0);
    assert.equal(forUser(A.staff).length, 0);
    assert.equal(forUser(B.admin).length, 0);
    const n = forUser(A.admin, 'INVOICE_ISSUED')[0];
    assert.equal(String(n.tenantId), String(A.tenant._id));
    assert.equal(n.actionUrl, `/client/invoices/${A.invoice._id}`);
    assert.equal(n.entityType, 'Invoice'); assert.equal(String(n.entityId), String(A.invoice._id));
    assert.equal(n.isRead, false); assert.equal(n.severity, 'INFO');
  });

  await t.test('idempotency: concurrent double-issue yields exactly one notification; re-firing the hook is a no-op', async () => {
    const draft = await services.invoiceService.create(A.ctx, { customerId: String(A.customer._id), invoiceDate: new Date('2026-04-03'), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }] });
    const results = await Promise.all([1, 2].map(() => api.post(`/api/v1/invoices/${draft._id}/issue`).set(aAdmin)));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const key = `INVOICE_ISSUED:${draft._id}`;
    assert.equal(await repos.notifications.countByDedupKey(A.admin._id, key), 1);
    const issued = await repos.invoices.findOneById(A.tenant._id, draft._id);
    assert.equal(await services.notificationService.invoiceIssued(issued), 0, 'second firing creates nothing');
    assert.equal(await services.notificationService.invoiceIssued(issued), 0);
    assert.equal(await repos.notifications.countByDedupKey(A.admin._id, key), 1);
    assert.equal(await repos.notifications.countByDedupKey(admin2._id, key), 1);
  });

  await t.test('INVOICE_CANCELLED notifies tenant admins with WARNING severity', async () => {
    await api.post(`/api/v1/invoices/${A.invoice._id}/cancel`).set(aAdmin).send({ reason: 'Customer returned goods' });
    const [n] = forUser(A.admin, 'INVOICE_CANCELLED');
    assert.equal(n.severity, 'WARNING');
    assert.match(n.message, /Customer returned goods/);
  });

  await t.test('TALLY_SYNC_FAILED per failed attempt (deduped per attempt) and TALLY_SYNC_SUCCEEDED once', async () => {
    const draft = await services.invoiceService.create(A.ctx, { customerId: String(A.customer._id), invoiceDate: new Date('2026-04-04'), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }] });
    await services.invoiceService.issue(A.ctx, draft._id);
    await repos.tallyIntegrations.upsert(A.tenant._id, { enabled: true, status: 'CONFIGURED', baseUrl: 'http://127.0.0.1:9', retryPolicy: { maxAttempts: 3 } });
    const realAdapter = services.tallySyncService.adapter;
    let mode = 'fail';
    services.tallySyncService.adapter = {
      syncInvoice: async () => (mode === 'fail' ? { success: false, errorCode: 'TALLY_UNREACHABLE', message: 'down' } : { success: true, voucherId: '9', voucherNumber: 'SALE-9' }),
    };
    try {
      assert.equal((await api.post(`/api/v1/invoices/${draft._id}/tally-sync`).set(aAdmin)).body.data.status, 'RETRYING');
      assert.equal((await api.post(`/api/v1/invoices/${draft._id}/tally-sync`).set(aAdmin)).body.data.status, 'RETRYING');
      const failed = forUser(A.admin, 'TALLY_SYNC_FAILED').filter((n) => String(n.entityId) === String(draft._id));
      assert.deepEqual(failed.map((n) => n.dedupKey).sort(), [`TALLY_SYNC_FAILED:${draft._id}:attempt-1`, `TALLY_SYNC_FAILED:${draft._id}:attempt-2`]);
      assert.ok(failed.every((n) => n.severity === 'WARNING'));
      mode = 'ok';
      assert.equal((await api.post(`/api/v1/invoices/${draft._id}/tally-sync`).set(aAdmin)).body.data.status, 'SYNCED');
      assert.equal((await api.post(`/api/v1/invoices/${draft._id}/tally-sync`).set(aAdmin)).body.data.status, 'SYNCED'); // idempotent no-op
      assert.equal(forUser(A.admin, 'TALLY_SYNC_SUCCEEDED').length, 1);
      assert.equal(forUser(B.admin).length, 0);
    } finally {
      services.tallySyncService.adapter = realAdapter;
    }
  });

  await t.test('GST filing ready/submitted/filed + issue opened/resolved notify tenant admins AND the assigned vendor', async () => {
    const created = await api.post('/api/v1/gst-filings').set(mA).send({ periodKey: '2026-04', returnType: 'GSTR_1', vendorUserId: String(vendorUser._id) });
    assert.equal(created.status, 201);
    const id = created.body.data._id;
    await api.post(`/api/v1/gst-filings/${id}/start`).set(v);
    assert.equal(forUser(vendorUser).length, 0, "'start' does not notify");
    await api.post(`/api/v1/gst-filings/${id}/ready`).set(v);
    await api.post(`/api/v1/gst-filings/${id}/submit`).set(v);
    await api.post(`/api/v1/gst-filings/${id}/mark-filed`).set(v);
    for (const type of ['GST_FILING_READY', 'GST_FILING_SUBMITTED', 'GST_FILING_FILED']) {
      assert.equal(forUser(A.admin, type).length, 1, type);
      assert.equal(forUser(vendorUser, type).length, 1, type);
      assert.equal(forUser(vendorUser, type)[0].actionUrl, `/vendor/filings/${id}`);
      assert.equal(forUser(A.admin, type)[0].actionUrl, `/client/gst-filings/${id}`);
    }
    // re-running a transition hook for the same filing is a no-op (forward-only state machine + dedup key)
    const filing = await repos.gstFilings.findOneById(A.tenant._id, id);
    assert.equal(await services.notificationService.filingTransitioned(filing, 'markFiled'), 0);

    const issue = await api.post(`/api/v1/gst-filings/${id}/issues`).set(v).send({ type: 'MISSING_DATA', severity: 'HIGH', title: 'PAN missing' });
    assert.equal(issue.status, 201);
    const opened = forUser(A.admin, 'GST_FILING_ISSUE_OPENED');
    assert.equal(opened.length, 1); assert.equal(opened[0].severity, 'CRITICAL');
    assert.equal(forUser(vendorUser, 'GST_FILING_ISSUE_OPENED').length, 1);

    const issueId = issue.body.data._id;
    await api.patch(`/api/v1/gst-filings/${id}/issues/${issueId}`).set(v).send({ status: 'RESOLVED', resolution: 'Added' });
    await api.patch(`/api/v1/gst-filings/${id}/issues/${issueId}`).set(v).send({ status: 'RESOLVED', resolution: 'Added again' });
    assert.equal(forUser(A.admin, 'GST_FILING_ISSUE_RESOLVED').length, 1, 'repeated RESOLVED patch does not re-notify');
    assert.equal(forUser(vendorUser, 'GST_FILING_ISSUE_RESOLVED').length, 1);
    assert.equal(forUser(B.admin).length, 0);
  });

  await t.test('an UNASSIGNED vendor no longer receives filing notifications (assignment chain re-checked at generation)', async () => {
    const created = await api.post('/api/v1/gst-filings').set(mA).send({ periodKey: '2026-05', returnType: 'GSTR_3B', vendorUserId: String(vendorUser._id) });
    const id = created.body.data._id;
    await api.post(`/api/v1/gst-filings/${id}/start`).set(mA);
    await api.delete(`/api/v1/vendors/${vendor._id}/assignments/${A.tenant._id}`).set(m);
    const before = forUser(vendorUser, 'GST_FILING_READY').length;
    await api.post(`/api/v1/gst-filings/${id}/ready`).set(mA);
    assert.equal(forUser(vendorUser, 'GST_FILING_READY').length, before);
    assert.equal(forUser(A.admin, 'GST_FILING_READY').filter((n) => String(n.entityId) === id).length, 1);
    await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(A.tenant._id) });
  });

  await t.test('VENDOR_ASSIGNMENT_CHANGED and CLIENT_STATUS_CHANGED (only on a real status change)', async () => {
    const assign = await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(B.tenant._id) });
    assert.equal(assign.status, 201);
    assert.ok(forUser(vendorUser, 'VENDOR_ASSIGNMENT_CHANGED').some((n) => String(n.tenantId) === String(B.tenant._id)));
    assert.equal(forUser(B.admin, 'VENDOR_ASSIGNMENT_CHANGED').length, 1);

    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'SUSPENDED', reason: 'Phase 9 notification test' });
    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'SUSPENDED', reason: 'repeat, no change' });
    const changes = forUser(B.admin, 'CLIENT_STATUS_CHANGED');
    assert.equal(changes.length, 1);
    assert.equal(changes[0].severity, 'CRITICAL');
    await api.patch(`/api/v1/clients/${B.tenant._id}/status`).set(m).send({ status: 'ACTIVE' });
    assert.equal(forUser(B.admin, 'CLIENT_STATUS_CHANGED').length, 2);
    assert.equal(forUser(A.admin, 'CLIENT_STATUS_CHANGED').length, 0);
  });

  await t.test('notification failure never breaks the business transition', async () => {
    const original = repos.notifications.createOnce;
    repos.notifications.createOnce = async () => { throw new Error('db down'); };
    try {
      const draft = await services.invoiceService.create(A.ctx, { customerId: String(A.customer._id), invoiceDate: new Date('2026-04-05'), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }] });
      assert.equal((await api.post(`/api/v1/invoices/${draft._id}/issue`).set(aAdmin)).status, 200);
    } finally {
      repos.notifications.createOnce = original;
    }
  });

  // ------------------------------------------------------------------ API
  await t.test('GET /notifications: own only, newest first, paginated, unread filter', async () => {
    const res = await api.get('/api/v1/notifications?limit=3').set(aAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 3);
    const total = forUser(A.admin).length;
    assert.equal(res.body.data.pagination.total, total);
    assert.ok(res.body.data.items.every((n) => n.recipientUserId === String(A.admin._id)));
    const all = (await api.get('/api/v1/notifications?limit=50').set(aAdmin)).body.data.items;
    for (let i = 1; i < all.length; i += 1) assert.ok(new Date(all[i - 1].createdAt) >= new Date(all[i].createdAt), 'newest first');
    const b = (await api.get('/api/v1/notifications?limit=50').set(bAdmin)).body.data.items;
    assert.ok(b.length > 0);
    assert.ok(b.every((n) => n.recipientUserId === String(B.admin._id) && String(n.tenantId) === String(B.tenant._id)), 'tenant/recipient isolation');
    assert.equal((await api.get('/api/v1/notifications?unread=maybe').set(aAdmin)).status, 400);
    assert.equal((await api.get(`/api/v1/notifications?recipientUserId=${B.admin._id}`).set(aAdmin)).status, 400, 'no recipient override param');
    assert.equal((await api.get('/api/v1/notifications')).status, 401);
    assert.equal((await api.get('/api/v1/notifications').set(aStaff)).body.data.pagination.total, 0);
  });

  await t.test('unread-count, mark one read (idempotent), mark-all-read', async () => {
    const count0 = (await api.get('/api/v1/notifications/unread-count').set(aAdmin)).body.data.unread;
    assert.equal(count0, forUser(A.admin).filter((n) => !n.isRead).length);
    const [first] = (await api.get('/api/v1/notifications?unread=true&limit=1').set(aAdmin)).body.data.items;
    const r1 = await api.patch(`/api/v1/notifications/${first._id}/read`).set(aAdmin);
    assert.equal(r1.status, 200); assert.equal(r1.body.data.isRead, true); assert.ok(r1.body.data.readAt);
    const r2 = await api.patch(`/api/v1/notifications/${first._id}/read`).set(aAdmin);
    assert.equal(r2.body.data.readAt, r1.body.data.readAt, 'readAt never overwritten');
    assert.equal((await api.get('/api/v1/notifications/unread-count').set(aAdmin)).body.data.unread, count0 - 1);
    const unreadOnly = (await api.get('/api/v1/notifications?unread=true&limit=50').set(aAdmin)).body.data;
    assert.ok(unreadOnly.items.every((n) => n.isRead === false));
    assert.equal(unreadOnly.pagination.total, count0 - 1);

    const otherAdminBefore = (await api.get('/api/v1/notifications/unread-count').set(a2)).body.data.unread;
    const all = await api.patch('/api/v1/notifications/read-all').set(aAdmin);
    assert.equal(all.status, 200); assert.equal(all.body.data.updated, count0 - 1);
    assert.equal((await api.get('/api/v1/notifications/unread-count').set(aAdmin)).body.data.unread, 0);
    assert.equal((await api.get('/api/v1/notifications/unread-count').set(a2)).body.data.unread, otherAdminBefore, "read-all never touches another user's notifications");
  });

  await t.test('IDOR: User A cannot read/mark User B\'s notification (404, B\'s stays unread)', async () => {
    const [bNote] = (await api.get('/api/v1/notifications?unread=true&limit=1').set(bAdmin)).body.data.items;
    assert.ok(bNote);
    const attempt = await api.patch(`/api/v1/notifications/${bNote._id}/read`).set(aAdmin);
    assert.equal(attempt.status, 404);
    const [a2Note] = (await api.get('/api/v1/notifications?unread=true&limit=1').set(a2)).body.data.items;
    assert.equal((await api.patch(`/api/v1/notifications/${a2Note._id}/read`).set(aAdmin)).status, 404, 'same-tenant other user also denied');
    assert.equal((await api.patch(`/api/v1/notifications/${bNote._id}/read`).set(v)).status, 404);
    const stored = fake.Notification.docs.find((d) => String(d._id) === bNote._id);
    assert.equal(stored.isRead, false);
    assert.equal((await api.patch('/api/v1/notifications/not-an-id/read').set(aAdmin)).status, 400);
    const body = await api.patch(`/api/v1/notifications/${bNote._id}/read`).set(bAdmin).send({ recipientUserId: String(A.admin._id) });
    assert.equal(body.status, 200, 'body-supplied recipient is ignored; ownership comes from the session');
    assert.equal(fake.Notification.docs.find((d) => String(d._id) === bNote._id).recipientUserId, String(B.admin._id));
  });

  await t.test('concurrency: simultaneous mark-read on the same notification -> consistent state, single readAt', async () => {
    const [n] = (await api.get('/api/v1/notifications?unread=true&limit=1').set(a2)).body.data.items;
    const before = (await api.get('/api/v1/notifications/unread-count').set(a2)).body.data.unread;
    const results = await Promise.all([1, 2, 3].map(() => api.patch(`/api/v1/notifications/${n._id}/read`).set(a2)));
    assert.ok(results.every((r) => r.status === 200));
    assert.equal(new Set(results.map((r) => r.body.data.readAt)).size, 1);
    assert.equal((await api.get('/api/v1/notifications/unread-count').set(a2)).body.data.unread, before - 1);
    const races = await Promise.all([api.patch('/api/v1/notifications/read-all').set(a2), api.patch('/api/v1/notifications/read-all').set(a2)]);
    assert.equal(races.reduce((s, r) => s + r.body.data.updated, 0), before - 1, 'each unread notification flipped exactly once');
  });
});
