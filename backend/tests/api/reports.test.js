import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';
import { buildPhase9Fixtures, EXPECTED, aprilQuery } from '../helpers/phase9Fixtures.js';

/** Minimal RFC 4180 parser (test-side) so assertions check real CSV semantics, not substrings. */
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 1; } else cell += c;
  }
  return rows;
}

test('Phase 9: reports — tenant isolation, pagination, filters, totals, filings, vendors, CSV export', async (t) => {
  const h = await createHarness();
  const { api, A, B, master, vendorUser, repos, services } = h;
  const fx = await buildPhase9Fixtures(h);
  const m = h.bearer((await h.login(master.email)).token);
  const mA = { ...m, 'X-Admin-Tenant-Id': String(A.tenant._id) };
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(vendorUser.email)).token);

  const filingA = await repos.gstFilings.create(A.tenant._id, {
    periodKey: '2026-04', returnType: 'GSTR_1', status: 'SUBMITTED', vendorUserId: String(vendorUser._id), milestones: [],
    submissionInfo: { acknowledgementNumber: 'DEMO-ACK-1', source: 'MANUALLY_RECORDED' },
  }, master._id);
  const filingB = await repos.gstFilings.create(B.tenant._id, { periodKey: '2026-03', returnType: 'GSTR_3B', status: 'NOT_STARTED', milestones: [] }, master._id);
  await repos.gstFilingIssues.create(A.tenant._id, { filingId: String(filingA._id), invoiceId: String(fx.inv2._id), type: 'TALLY_SYNC', severity: 'CRITICAL', title: 'inv2 sync failed', status: 'OPEN', raisedBy: vendorUser._id });
  await repos.gstFilingIssues.create(A.tenant._id, { filingId: String(filingA._id), type: 'OTHER', severity: 'LOW', title: 'old note', status: 'RESOLVED', raisedBy: vendorUser._id, resolvedAt: new Date('2026-04-20') });
  await repos.gstFilingIssues.create(B.tenant._id, { filingId: String(filingB._id), type: 'OTHER', severity: 'MEDIUM', title: 'B only issue', status: 'OPEN', raisedBy: master._id });

  const get = (path, who) => api.get(`/api/v1${path}`).set(who);

  // ------------------------------------------------------------------ invoice summary
  await t.test('invoice-summary: totals row is computed over ALL filtered rows, identical on every page', async () => {
    const p1 = await get(`/reports/invoice-summary?${aprilQuery}&limit=2&page=1`, aAdmin);
    const p3 = await get(`/reports/invoice-summary?${aprilQuery}&limit=2&page=3`, aAdmin);
    assert.equal(p1.status, 200);
    assert.equal(p1.body.data.items.length, 2);
    assert.equal(p3.body.data.items.length, 1);
    assert.deepEqual(p1.body.data.pagination, { page: 1, limit: 2, total: 5, totalPages: 3 });
    assert.deepEqual(p1.body.data.summary.totals, EXPECTED.aprilAllTotals);
    assert.deepEqual(p3.body.data.summary.totals, EXPECTED.aprilAllTotals);
    assert.deepEqual(p1.body.data.summary.byStatus, EXPECTED.aprilByStatus);
  });

  await t.test('invoice-summary: status filter + GST values equal the invoices\' stored authoritative fields', async () => {
    const res = await get(`/reports/invoice-summary?${aprilQuery}&status=ISSUED&limit=100`, aAdmin);
    assert.deepEqual(res.body.data.summary.totals, EXPECTED.aprilIssued);
    assert.equal(res.body.data.items.length, 3);
    for (const row of res.body.data.items) {
      const stored = await repos.invoices.findOneById(A.tenant._id, row._id);
      for (const f of ['taxableAmount', 'cgst', 'sgst', 'igst', 'totalTax', 'grandTotal']) assert.equal(row[f], String(stored[f]), `${row.invoiceNumber}.${f}`);
    }
    const byId = Object.fromEntries(res.body.data.items.map((r) => [r._id, r.tallySyncStatus]));
    assert.equal(byId[String(fx.inv1._id)], 'SYNCED');
    assert.equal(byId[String(fx.inv2._id)], 'FAILED');
    assert.equal(byId[String(fx.inv6._id)], 'NOT_SYNCED');
    assert.equal((await get(`/reports/invoice-summary?${aprilQuery}&status=BOGUS`, aAdmin)).status, 400);
  });

  await t.test('invoice-summary: tenant isolation (B sees only B; Master header scopes to that tenant)', async () => {
    const b = (await get(`/reports/invoice-summary?${aprilQuery}`, bAdmin)).body.data;
    assert.equal(b.pagination.total, 1);
    assert.equal(b.items[0].customerName, 'B Customer');
    assert.equal(b.summary.totals.grandTotal, EXPECTED.bAprilIssued.grandTotal);
    const viaMaster = (await get(`/reports/invoice-summary?${aprilQuery}`, mA)).body.data;
    assert.equal(viaMaster.pagination.total, 5);
    assert.ok(viaMaster.items.every((r) => r.customerName === 'A Customer'));
  });

  // ------------------------------------------------------------------ GST summary
  await t.test('gst-summary: ISSUED-only period aggregation matches hand-computed values', async () => {
    const res = await get('/reports/gst-summary?range=custom&from=2026-04-01&to=2026-05-31', aAdmin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items.map(({ _id, ...r }) => r), EXPECTED.gstAprMay.rows);
    assert.deepEqual(res.body.data.summary.totals, EXPECTED.gstAprMay.totals);
    const b = (await get('/reports/gst-summary?range=custom&from=2026-04-01&to=2026-05-31', bAdmin)).body.data;
    assert.equal(b.summary.totals.invoiceCount, 1);
    assert.equal(b.summary.totals.taxableAmount, '200.00');
  });

  // ------------------------------------------------------------------ Tally sync
  await t.test('tally-sync: status counts, latest success, failure reasons (read-only), tenant-scoped', async () => {
    const res = await get(`/reports/tally-sync?${aprilQuery}`, aAdmin);
    assert.equal(res.status, 200);
    const s = res.body.data.summary;
    assert.equal(s.byStatus.SYNCED, 1); assert.equal(s.byStatus.FAILED, 1); assert.equal(s.byStatus.SYNCING, 0);
    assert.equal(new Date(s.latestSuccessfulSyncAt).toISOString(), '2026-04-02T10:00:05.000Z');
    assert.deepEqual(s.failureReasons.map((r) => [r.errorCode, r.count]), [['TALLY_UNREACHABLE', 1]]);
    assert.ok(res.body.data.items.some((r) => r.invoiceNumber === fx.inv2.invoiceNumber && r.errorMessage === 'Connection refused'));
    assert.equal((await get(`/reports/tally-sync?${aprilQuery}`, bAdmin)).body.data.pagination.total, 0);
    assert.equal(await h.fake.TallySyncLog.docs.length, 2, 'report never creates/triggers syncs');
  });

  // ------------------------------------------------------------------ GST filing status / issues
  await t.test('gst-filing-status: readiness computed, submission info pinned to MANUALLY_RECORDED, tenant-scoped', async () => {
    const res = await get('/reports/gst-filing-status', aAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.pagination.total, 1);
    const row = res.body.data.items[0];
    assert.equal(row.status, 'SUBMITTED');
    assert.equal(row.assignedVendor, 'Vendor User');
    assert.equal(row.openIssues, 1);
    assert.equal(row.submissionInfo.source, 'MANUALLY_RECORDED');
    assert.equal(row.submissionInfo.acknowledgementNumber, 'DEMO-ACK-1');
    assert.equal(row.readiness.ready, false);
    assert.ok(row.readiness.blockers.includes('1 open critical issue(s)'));
    assert.ok(row.readiness.blockers.includes('2 issued invoice(s) not Tally-synced')); // inv2 FAILED + inv6 no record (April)
    assert.deepEqual(res.body.data.summary.byStatus, { NOT_STARTED: 0, IN_PROGRESS: 0, READY_FOR_REVIEW: 0, SUBMITTED: 1, FILED: 0 });
    assert.equal((await get('/reports/gst-filing-status?range=custom&from=2026-05-01&to=2026-05-31', aAdmin)).body.data.pagination.total, 0);
  });

  await t.test('gst-filing-issues: rows decorated with filing/invoice/vendor; severity filter; tenant-scoped', async () => {
    const res = await get('/reports/gst-filing-issues', aAdmin);
    assert.equal(res.body.data.pagination.total, 2);
    assert.deepEqual(res.body.data.summary.byStatus, { OPEN: 1, IN_PROGRESS: 0, RESOLVED: 1, CLOSED: 0 });
    assert.deepEqual(res.body.data.summary.openBySeverity, { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 1 });
    const crit = (await get('/reports/gst-filing-issues?severity=CRITICAL', aAdmin)).body.data.items;
    assert.equal(crit.length, 1);
    assert.equal(crit[0].invoiceNumber, fx.inv2.invoiceNumber);
    assert.equal(crit[0].filingPeriod, '2026-04');
    assert.equal(crit[0].assignedVendor, 'Vendor User');
    const b = (await get('/reports/gst-filing-issues', bAdmin)).body.data;
    assert.deepEqual(b.items.map((i) => i.title), ['B only issue']);
  });

  await t.test('master cross-tenant filing reports: all tenants by default, narrowable by clientId, Master-only', async () => {
    const all = (await get('/master/reports/gst-filing-status', m)).body.data;
    assert.equal(all.pagination.total, 2);
    assert.deepEqual(all.items.map((r) => r.clientName).sort(), ['Business A', 'Business B']);
    const onlyB = (await get(`/master/reports/gst-filing-issues?clientId=${B.tenant._id}`, m)).body.data;
    assert.deepEqual(onlyB.items.map((i) => i.title), ['B only issue']);
    assert.equal((await get('/master/reports/invoice-summary', m)).status, 404, 'financial reports are never cross-tenant');
    assert.equal((await get('/master/reports/gst-filing-status', aAdmin)).status, 403);
    assert.equal((await get('/master/reports/gst-filing-status', v)).status, 403);
  });

  // ------------------------------------------------------------------ customer summary
  await t.test('customer-summary: status/GST-registration breakdown and per-customer issued totals', async () => {
    await api.post('/api/v1/customers').set(aAdmin).send({ name: 'Registered Buyer', gstin: '27AAAPL1234C1Z5' });
    const res = await get('/reports/customer-summary', aAdmin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.summary.byGstRegistration, { GST_REGISTERED: 1, UNREGISTERED: 1 });
    assert.equal(res.body.data.summary.byStatus.ACTIVE, 2);
    const fixtureCustomer = res.body.data.items.find((c) => c._id === String(A.customer._id));
    assert.equal(fixtureCustomer.issuedInvoiceCount, EXPECTED.customerIssued.count);
    assert.equal(fixtureCustomer.issuedGrandTotal, EXPECTED.customerIssued.grandTotal);
    assert.equal((await get('/reports/customer-summary', bAdmin)).body.data.pagination.total, 1);
  });

  // ------------------------------------------------------------------ security / RBAC
  await t.test('security: manipulated tenantId in report query is rejected (tenant user) or ignored (Master header wins)', async () => {
    assert.equal((await get(`/reports/invoice-summary?${aprilQuery}&tenantId=${B.tenant._id}`, aAdmin)).status, 403);
    const own = await get(`/reports/invoice-summary?${aprilQuery}&tenantId=${A.tenant._id}`, aAdmin);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.pagination.total, 5);
    const viaMaster = await get(`/reports/invoice-summary?${aprilQuery}&tenantId=${B.tenant._id}`, mA);
    assert.equal(viaMaster.status, 200);
    assert.equal(viaMaster.body.data.pagination.total, 5, 'header tenant (A) used, query tenantId ignored');
    assert.equal((await get(`/reports/invoice-summary?${aprilQuery}`, m)).status, 400, 'Master needs the explicit header');
  });

  await t.test('RBAC: permission-checked per report; CLIENT_USER without reports.view denied; unknown report 404', async () => {
    assert.equal((await get('/reports/invoice-summary', aStaff)).status, 403);
    assert.equal((await get('/reports', aStaff)).status, 403);
    assert.equal((await get('/reports/not-a-report', aAdmin)).status, 404);
    const catalog = (await get('/reports', aAdmin)).body.data.map((r) => r.key).sort();
    assert.deepEqual(catalog, ['customer-summary', 'gst-filing-issues', 'gst-filing-status', 'gst-summary', 'invoice-summary', 'tally-sync']);
    assert.equal((await get('/reports/invoice-summary', v)).status, 403, 'vendors have no tenant-route report access');
  });

  await t.test('vendor reports: assigned tenant allowed via the Phase 7 chain; unassigned denied; no customer data', async () => {
    const ok = await get(`/vendors/me/clients/${A.tenant._id}/reports/gst-filing-status`, v);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.items[0].periodKey, '2026-04');
    const inv = await get(`/vendors/me/clients/${A.tenant._id}/reports/invoice-summary?${aprilQuery}`, v);
    assert.equal(inv.body.data.summary.totals.grandTotal, EXPECTED.aprilAllTotals.grandTotal);
    assert.equal((await get(`/vendors/me/clients/${B.tenant._id}/reports/gst-filing-status`, v)).status, 403);
    assert.equal((await get(`/vendors/me/clients/${A.tenant._id}/reports/customer-summary`, v)).status, 403);
    assert.equal((await get(`/vendors/me/clients/${A.tenant._id}/reports/gst-filing-status?tenantId=${B.tenant._id}`, v)).status, 400, 'strict query rejects tenantId');
    assert.equal((await get(`/vendors/me/clients/${A.tenant._id}/reports/gst-filing-status`, aAdmin)).status, 403);
  });

  // ------------------------------------------------------------------ CSV export
  await t.test('CSV: escaping of comma/quote/newline and formula-injection neutralisation', async () => {
    const tricky = (await api.post('/api/v1/customers').set(aAdmin).send({ name: 'Acme, "Best"\nTraders' })).body.data;
    const formula = (await api.post('/api/v1/customers').set(aAdmin).send({ name: '=HYPERLINK("http://evil.example")' })).body.data;
    for (const c of [tricky, formula]) {
      const created = await services.invoiceService.create(A.ctx, { customerId: String(c._id), invoiceDate: new Date('2026-04-28'), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: '1' }] });
      await services.invoiceService.issue(A.ctx, created._id);
    }
    const res = await get(`/reports/invoice-summary/export?${aprilQuery}`, aAdmin);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/csv/);
    assert.match(res.headers['content-disposition'], /^attachment; filename="invoice-summary-\d{4}-\d{2}-\d{2}\.csv"$/);
    const raw = res.text;
    assert.ok(raw.includes('"Acme, ""Best""\nTraders"'), 'quoted with doubled quotes and embedded newline');
    assert.ok(raw.includes(`"'=HYPERLINK(""http://evil.example"")"`), 'formula neutralised with leading single quote');
    const rows = parseCsv(raw);
    assert.equal(rows[0][0], 'Invoice number');
    assert.equal(rows.length, 1 + 7, 'header + 7 April invoices');
    assert.ok(rows.some((r) => r[2] === 'Acme, "Best"\nTraders'));
    assert.ok(rows.some((r) => r[2] === '\'=HYPERLINK("http://evil.example")'));
    assert.ok(rows.every((r) => r.length === rows[0].length));
    assert.ok(!raw.includes('B Customer'), 'tenant-scoped export');
  });

  await t.test('CSV: row cap exceeded -> 422 with a clear error, never silent truncation', async () => {
    services.reportService.exportMaxRows = 3;
    try {
      const res = await get(`/reports/invoice-summary/export?${aprilQuery}`, aAdmin);
      assert.equal(res.status, 422);
      assert.equal(res.body.error.code, 'EXPORT_ROW_LIMIT_EXCEEDED');
      assert.equal(res.body.error.details[0].maxRows, 3);
      assert.equal(res.body.error.details[0].rowCount, 7);
      assert.equal((await get(`/reports/invoice-summary/export?${aprilQuery}&status=DRAFT`, aAdmin)).status, 200, 'narrowed filter fits under the cap');
    } finally {
      services.reportService.exportMaxRows = 10_000;
    }
  });

  await t.test('CSV: permission-checked (reports.export), audited as DATA_EXPORT, /invoices/export alias works', async () => {
    assert.equal((await get('/reports/invoice-summary/export', aStaff)).status, 403);
    const before = h.fake.AuditLog.docs.filter((d) => d.action === 'DATA_EXPORT').length;
    const res = await get('/reports/gst-filing-status/export', aAdmin);
    assert.equal(res.status, 200);
    const exports = h.fake.AuditLog.docs.filter((d) => d.action === 'DATA_EXPORT');
    assert.equal(exports.length, before + 1);
    const last = exports.at(-1);
    assert.equal(String(last.tenantId), String(A.tenant._id));
    assert.equal(last.metadata.report, 'gst-filing-status');
    assert.equal(last.metadata.rowCount, 1);
    assert.equal(String(last.actorId), String(A.admin._id));
    assert.match(res.text, /MANUALLY_RECORDED/);
    const alias = await get(`/invoices/export?${aprilQuery}`, aAdmin);
    assert.equal(alias.status, 200);
    assert.equal(parseCsv(alias.text).length, 8);
    const masterExport = await get('/master/reports/gst-filing-issues/export', m);
    assert.equal(masterExport.status, 200);
    assert.equal(parseCsv(masterExport.text).length, 1 + 3);
  });
});
