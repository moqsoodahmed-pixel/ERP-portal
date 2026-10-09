import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/** Same mock-Tally-voucher-export server as tests/api/gstBillMatching.test.js — reused here only to reach
 * a FULLY_MATCHED Phase 20 result, which is the precondition for a Phase 21 final-document upload. */
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

const pdfDoc = (name = 'final.pdf') => ({ fileName: name, mimeType: 'application/pdf', contentBase64: Buffer.from('final-doc-bytes').toString('base64') });

test('Phase 21: vendor final document upload + client GST Billing Dashboard visibility', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(h.vendorUser.email)).token);
  const mock = await startMockTallyVouchers();
  t.after(() => mock.server.close());

  const { formatCode } = await import('../../src/utils/codes.js');
  const { ID_PREFIX } = await import('../../src/constants/pagination.js');
  const { hashPassword } = await import('../../src/security/password.js');
  const vendor2Code = formatCode(ID_PREFIX.vendor, await h.repos.counters.next(null, 'vendor'));
  const vendor2 = await h.repos.vendors.create({ vendorCode: vendor2Code, name: 'Vendor Two', status: 'ACTIVE' });
  const vendor2User = await h.repos.users.createUnscoped({
    vendorId: vendor2._id, name: 'Vendor Two User', email: 'finaldoc-vendor2@example.test', passwordHash: await hashPassword('Dev-Only-Pass-123'), role: 'GST_VENDOR', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0,
  });
  const v2 = h.bearer((await h.login(vendor2User.email)).token);

  await api.post('/api/v1/tally/config').set(aAdmin).send(baseConfig(mock.url));

  const makeFullyMatchedFiling = async (periodKey) => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey, returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Matched Item', rate: '500' }] });
    mock.state.vouchers = [{ voucherNumber: 'TALLY-FD-1', narration: 'Matched Item', amount: '500' }];
    const matchRes = await api.post(`/api/v1/gst-filings/${filing._id}/tally-matching/run`).set(v).send();
    assert.equal(matchRes.body.data.overallStatus, 'FULLY_MATCHED');
    return filing;
  };

  await t.test('vendor cannot upload final document before matching is FULLY_MATCHED', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2031-01', returnType: 'GSTR_1' });
    const filing = filingRes.body.data;
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Not Yet Matched', rate: '10' }] });
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc()] });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'GST_MATCHING_NOT_COMPLETE');
  });

  await t.test('authorized vendor can upload the final document once FULLY_MATCHED; stored via FileMetadata/StorageService, associated with the correct filing/bill', async () => {
    const filing = await makeFullyMatchedFiling('2031-02');
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc('GST Final Bill.pdf')] });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.finalDocuments.length, 1);
    assert.equal(res.body.data.finalDocuments[0].fileName, 'GST Final Bill.pdf');
    assert.ok(res.body.data.finalDocuments[0].id);
    assert.ok(res.body.data.finalDocuments[0].uploadedAt);
    // The client's own bill (items/subtotal/GST/total/documentIds) must be completely untouched.
    assert.equal(res.body.data.items[0].productName, 'Matched Item');
    assert.deepEqual(res.body.data.documentIds, []);

    // No internal fields ever leak.
    const dump = JSON.stringify(res.body.data.finalDocuments[0]);
    assert.equal(dump.includes('storageKey'), false);
    assert.equal(dump.includes('storageProvider'), false);
  });

  await t.test('client can list and securely download the vendor final document; storageKey never exposed', async () => {
    const filing = await makeFullyMatchedFiling('2031-03');
    await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc('Client View Test.pdf')] });

    const list = await api.get(`/api/v1/gst-filings/${filing._id}/final-documents`).set(aAdmin);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1);
    assert.equal(list.body.data.items[0].fileName, 'Client View Test.pdf');
    assert.equal(JSON.stringify(list.body).includes('storageKey'), false);

    const docId = list.body.data.items[0].id;
    const download = await api.get(`/api/v1/gst-filings/${filing._id}/final-documents/${docId}`).set(aAdmin);
    assert.equal(download.status, 200);
    assert.equal(Buffer.from(download.body).toString('utf8'), 'final-doc-bytes');
  });

  await t.test('empty state: a filing with no final document yet returns an empty list, not an error', async () => {
    const filingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2031-04', returnType: 'GSTR_1' });
    const res = await api.get(`/api/v1/gst-filings/${filingRes.body.data._id}/final-documents`).set(aAdmin);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
  });

  await t.test('multiple final documents accumulate (append-only), never silently replaced/deleted', async () => {
    const filing = await makeFullyMatchedFiling('2031-05');
    await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc('First.pdf')] });
    const second = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc('Second.pdf')] });
    assert.equal(second.body.data.finalDocuments.length, 2);
    assert.deepEqual(second.body.data.finalDocuments.map((d) => d.fileName).sort(), ['First.pdf', 'Second.pdf']);
  });

  await t.test('invalid/oversized file rejected', async () => {
    const filing = await makeFullyMatchedFiling('2031-06');
    const badType = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({
      documents: [{ fileName: 'bad.exe', mimeType: 'application/x-msdownload', contentBase64: Buffer.from('x').toString('base64') }],
    });
    assert.equal(badType.status, 400);

    const oversized = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({
      documents: [{ fileName: 'big.pdf', mimeType: 'application/pdf', contentBase64: Buffer.alloc(6 * 1024 * 1024, 'a').toString('base64') }],
    });
    // 413 (body-parser's own request-size limit, hit before the handler runs) is an equally valid rejection
    // of an oversized payload as a 400 from the zod schema's own max-length check.
    assert.ok([400, 413].includes(oversized.status), `expected 400 or 413, got ${oversized.status}`);
  });

  await t.test('RBAC: CLIENT_ADMIN and CLIENT_USER cannot upload (view-only); MASTER_ADMIN retains access', async () => {
    const filing = await makeFullyMatchedFiling('2031-07');
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(aAdmin).send({ documents: [pdfDoc()] })).status, 403);
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(aStaff).send({ documents: [pdfDoc()] })).status, 403);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/final-documents`).set(aStaff)).status, 403, 'CLIENT_USER has no gst_bills.view by default');

    const m = h.bearer((await h.login(h.master.email)).token);
    const adminHeader = { ...m, 'X-Admin-Tenant-Id': String(A.tenant._id) };
    const masterUpload = await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(adminHeader).send({ documents: [pdfDoc('Admin.pdf')] });
    assert.equal(masterUpload.status, 200);
  });

  await t.test('SECURITY: vendor not assigned to tenant A cannot upload/view, even with a valid filingId', async () => {
    const filing = await makeFullyMatchedFiling('2031-08');
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v2).send({ documents: [pdfDoc()] })).status, 403);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/final-documents`).set(v2)).status, 403);
  });

  await t.test('SECURITY: cross-tenant upload/view denied — tenant B cannot touch tenant A\'s filing', async () => {
    const filing = await makeFullyMatchedFiling('2031-09');
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(bAdmin).send({ documents: [pdfDoc()] })).status, 403);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/final-documents`).set(bAdmin)).status, 403);
  });

  await t.test('SECURITY: document id from another filing cannot be used to download a final document (IDOR)', async () => {
    const filingX = await makeFullyMatchedFiling('2031-10');
    const filingY = await makeFullyMatchedFiling('2031-11');
    const uploadX = await api.post(`/api/v1/gst-filings/${filingX._id}/final-document`).set(v).send({ documents: [pdfDoc('X-Doc.pdf')] });
    const xDocId = uploadX.body.data.finalDocuments[0].id;
    const res = await api.get(`/api/v1/gst-filings/${filingY._id}/final-documents/${xDocId}`).set(aAdmin);
    assert.equal(res.status, 404);
  });

  await t.test('Phase 4 matching data is unchanged after a final-document upload', async () => {
    const filing = await makeFullyMatchedFiling('2031-12');
    const before = await api.get(`/api/v1/gst-filings/${filing._id}/tally-matching`).set(v);
    await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc()] });
    const after = await api.get(`/api/v1/gst-filings/${filing._id}/tally-matching`).set(v);
    assert.deepEqual(before.body.data.results, after.body.data.results);
    assert.equal(after.body.data.overallStatus, 'FULLY_MATCHED');
  });

  await t.test('audit event recorded for the final-document upload', async () => {
    const filing = await makeFullyMatchedFiling('2032-01');
    await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).set(v).send({ documents: [pdfDoc()] });
    const rows = await h.repos.audit.model.find({ action: 'GST_FINAL_DOCUMENT_UPLOADED' });
    assert.ok(rows.length >= 1);
  });

  await t.test('unauthenticated requests are rejected', async () => {
    const filing = await makeFullyMatchedFiling('2032-02');
    assert.equal((await api.post(`/api/v1/gst-filings/${filing._id}/final-document`).send({ documents: [pdfDoc()] })).status, 401);
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/final-documents`)).status, 401);
  });
});
