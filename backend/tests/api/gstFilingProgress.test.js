import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/** Same mock-Tally-voucher-export server as tests/api/gstBillMatching.test.js — reused only to reach a
 * FULLY_MATCHED Phase 20 result for the "Tally Matched" / "Completed" progress states below. */
function startMockTallyVouchers() {
  const state = { mode: 'success', vouchers: [] };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    const items = state.vouchers.map((v) => `<VOUCHER><DATE>20260101</DATE><VOUCHERNUMBER>${v.voucherNumber}</VOUCHERNUMBER><PARTYNAME>Cash</PARTYNAME><NARRATION>${v.narration}</NARRATION><AMOUNT>${v.amount}</AMOUNT></VOUCHER>`).join('');
    res.end(`<ENVELOPE>${items}</ENVELOPE>`);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

const baseConfig = (baseUrl) => ({
  enabled: true, connectionType: 'LOCAL_TALLY', baseUrl, companyName: 'Test Co', defaultVoucherType: 'Sales',
  salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', timeoutMs: 2000, retryMaxAttempts: 3,
});

const pdfDoc = (name = 'bill.pdf') => ({ fileName: name, mimeType: 'application/pdf', contentBase64: Buffer.from('bytes').toString('base64') });

test('Phase 22: GST Filing Progress workspace tracker (read-only, consumes existing Phase 1-5 data)', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(h.vendorUser.email)).token);
  const mock = await startMockTallyVouchers();
  t.after(() => mock.server.close());
  await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));

  await t.test('empty state: a client with no filings gets an empty progress list and zeroed summary', async () => {
    const fresh = await h.mkTenant('NoFilings', { withInvoice: false });
    const freshAdmin = h.bearer((await h.login(fresh.admin.email)).token);
    const res = await api.get('/api/v1/gst-filings/progress').set(freshAdmin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
    assert.deepEqual(res.body.data.summary, {
      totalFilings: 0, inProgress: 0, tallyMatched: 0, completed: 0,
    });
  });

  await t.test('CASE: company details missing entirely => "Company Details Pending", 0%', async () => {
    const fresh = await h.mkTenant('NoProfile', { withInvoice: false });
    const freshAdmin = h.bearer((await h.login(fresh.admin.email)).token);
    await api.post('/api/v1/gst-filings').set(freshAdmin).send({ periodKey: '2033-01', returnType: 'GSTR_1' });
    const res = await api.get('/api/v1/gst-filings/progress').set(freshAdmin);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    const item = res.body.data.items[0];
    assert.equal(item.status, 'Company Details Pending');
    assert.equal(item.progressPercent, 0);
    assert.equal(item.steps.companyDetails, false);
  });

  await t.test('CASE C: company details + filing exist, no bill => "Bill Creation Pending", 20%', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-02', returnType: 'GSTR_1' });
    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filingRes.body.data._id);
    assert.equal(item.status, 'Bill Creation Pending');
    assert.equal(item.progressPercent, 20);
    assert.deepEqual(item.steps, {
      companyDetails: true, billCreated: false, billUploaded: false, tallyMatched: false, finalDocument: false,
    });
  });

  await t.test('CASE: bill exists, no client document => "Bill Upload Pending", 40%', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-03', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '100' }] });
    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filing._id);
    assert.equal(item.status, 'Bill Upload Pending');
    assert.equal(item.progressPercent, 40);
  });

  await t.test('CASE C (per spec example): client document uploaded, no Tally match yet => "Tally Matching Pending", 60%', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-04', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '100' }] });
    await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({ documents: [pdfDoc()] });
    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filing._id);
    assert.equal(item.status, 'Tally Matching Pending');
    assert.equal(item.progressPercent, 60);
    assert.equal(item.steps.billUploaded, true);
    assert.equal(item.steps.tallyMatched, false);
    assert.equal(item.tally, null);
  });

  await t.test('CASE B: Tally matching is 9/10 (PARTIAL_MATCH) => "Tally Matching Issue", progress capped at 60% (never 80%)', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-05', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    const items = Array.from({ length: 10 }, (_, i) => ({ productName: `P${i}`, rate: String(100 + i) }));
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items });
    await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({ documents: [pdfDoc()] });
    // Only 9 of the 10 items get a matching voucher -> PARTIAL_MATCH.
    mock.state.vouchers = items.slice(0, 9).map((it, i) => ({ voucherNumber: `T-${i}`, narration: it.productName, amount: it.rate }));
    const matchRes = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(matchRes.body.data.overallStatus, 'PARTIAL_MATCH');

    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filing._id);
    assert.equal(item.status, 'Tally Matching Issue');
    assert.equal(item.progressPercent, 60, 'progress must stay at the previous completed stage, never 80%');
    assert.equal(item.steps.tallyMatched, false);
    assert.equal(item.tally.overallStatus, 'PARTIAL_MATCH');
    assert.equal(item.tally.matchedCount, 9);
    assert.notEqual(res.body.data.summary.completed, 1);
  });

  await t.test('CASE: FULLY_MATCHED but no final document yet => "Final Document Pending", 80%', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-06', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Solo', rate: '500' }] });
    await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({ documents: [pdfDoc()] });
    mock.state.vouchers = [{ voucherNumber: 'T-SOLO', narration: 'Solo', amount: '500' }];
    const matchRes = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(matchRes.body.data.overallStatus, 'FULLY_MATCHED');

    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filing._id);
    assert.equal(item.status, 'Final Document Pending');
    assert.equal(item.progressPercent, 80);
    assert.equal(item.steps.tallyMatched, true);
    assert.equal(item.steps.finalDocument, false);
    assert.ok(res.body.data.summary.tallyMatched >= 1);
  });

  await t.test('CASE A: FULLY_MATCHED + final document => "Completed", 100%', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2033-07', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Done', rate: '750' }] });
    await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({ documents: [pdfDoc()] });
    mock.state.vouchers = [{ voucherNumber: 'T-DONE', narration: 'Done', amount: '750' }];
    await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc('final.pdf')] });

    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const item = res.body.data.items.find((i) => i.filingId === filing._id);
    assert.equal(item.status, 'Completed');
    assert.equal(item.progressPercent, 100);
    assert.deepEqual(item.steps, {
      companyDetails: true, billCreated: true, billUploaded: true, tallyMatched: true, finalDocument: true,
    });
    assert.equal(item.finalDocumentCount, 1);
    assert.ok(res.body.data.summary.completed >= 1);
  });

  await t.test('security: client cannot see another tenant\'s filings in their own progress response', async () => {
    const resA = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    const resB = await api.get('/api/v1/gst-filings/progress').set(bAdmin);
    const aIds = new Set(resA.body.data.items.map((i) => i.filingId));
    const bIds = resB.body.data.items.map((i) => i.filingId);
    assert.ok(bIds.every((id) => !aIds.has(id)));
  });

  await t.test('RBAC: CLIENT_USER (no gst.view by default) and GST_VENDOR cannot use the client progress endpoint; MASTER_ADMIN is also excluded (client-only view)', async () => {
    assert.equal((await api.get('/api/v1/gst-filings/progress').set(aStaff)).status, 403);
    assert.equal((await api.get('/api/v1/gst-filings/progress').set(v)).status, 403);
    const m = h.bearer((await h.login(h.master.email)).token);
    assert.equal((await api.get('/api/v1/gst-filings/progress').set(m)).status, 403);
  });

  await t.test('unauthenticated access is rejected', async () => {
    assert.equal((await api.get('/api/v1/gst-filings/progress')).status, 401);
  });

  await t.test('"progress" is never matched as a filing id by the adjacent /:id route', async () => {
    const res = await api.get('/api/v1/gst-filings/progress').set(aAdmin);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data.items));
  });
});
