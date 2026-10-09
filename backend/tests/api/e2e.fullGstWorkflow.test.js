import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHarness } from '../helpers/harness.js';

/**
 * End-to-end smoke test for the manual QA session: replays the EXACT sequence of calls each frontend page
 * makes, in order, through the real Express app (supertest) — not internal unit calls. This is meant to
 * catch the same class of bug as the `api.put` frontend wiring bug: a wrong HTTP method, a renamed field,
 * or a response shape the frontend doesn't actually destructure correctly.
 */
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

const b64 = (s) => Buffer.from(s).toString('base64');

test('E2E: client creates filing -> bill -> upload -> vendor views -> Tally matches -> final doc -> client dashboard', async (t) => {
  const h = await createHarness();
  const { api } = h;

  // Fresh tenant with NO seeded business profile, so this test exercises Phase 1's own company-details save.
  const tenant = await h.mkTenant('E2E', { withInvoice: false });
  const client = h.bearer((await h.login(tenant.admin.email)).token);
  const vendor = h.bearer((await h.login(h.vendorUser.email)).token);
  const master = h.bearer((await h.login(h.master.email)).token);
  await api.post(`/api/v1/vendors/${h.vendor._id}/assignments`).set(master).send({ tenantId: String(tenant.tenant._id) });

  const mock = await startMockTallyVouchers();
  t.after(() => mock.server.close());

  // ---- NewFilingPage: step 1 (company details) + step 2 (create filing) --------------------------------
  await t.test('NewFilingPage flow: GET business-profile (404 empty) -> POST business-profile -> POST gst-filings', async () => {
    const empty = await api.get('/api/v1/business-profile').set(client);
    assert.equal(empty.status, 404, 'NewFilingPage treats this as "profile not set up yet"');

    const profileRes = await api.post('/api/v1/business-profile').set(client).send({
      displayName: 'E2E Traders Pvt Ltd', gstin: '29ABCDE1234F1Z5', address: { line1: 'No. 1, Test Street' },
    });
    assert.equal(profileRes.status, 201);
    assert.ok(profileRes.body.data.displayName, 'NewFilingPage does not read this field back directly but confirms shape');

    const filingRes = await api.post('/api/v1/gst-filings').set(client).send({ periodKey: '2026-10', returnType: 'GSTR_1' });
    assert.equal(filingRes.status, 201);
    assert.ok(filingRes.body.data._id, 'NewFilingPage navigates using data._id');
    t.filingId = filingRes.body.data._id;
  });

  // ---- BillBuilderPage: load (empty) -> PUT bill -> POST document ----------------------------------------
  await t.test('BillBuilderPage flow: GET business-profile -> GET bill (404 empty) -> PUT bill -> POST document -> GET document', async () => {
    const profile = await api.get('/api/v1/business-profile').set(client);
    assert.equal(profile.status, 200);
    assert.equal(profile.body.data.displayName, 'E2E Traders Pvt Ltd');
    assert.equal(profile.body.data.gstin, '29ABCDE1234F1Z5');
    assert.ok(profile.body.data.address?.line1, 'BillBuilderPage reads company.address.line1 for the header');

    const emptyBill = await api.get(`/api/v1/gst-filings/${t.filingId}/bill`).set(client);
    assert.equal(emptyBill.status, 404, 'BillBuilderPage shows one blank row when no bill exists yet');

    const saved = await api.put(`/api/v1/gst-filings/${t.filingId}/bill`).set(client).send({
      items: [
        { productName: 'Website Development', rate: '25000' },
        { productName: 'Domain Registration', rate: '1500' },
      ],
    });
    assert.equal(saved.status, 200, 'this is exactly the call that failed with "api.put is not a function" before the fix');
    assert.equal(saved.body.data.items.length, 2);
    assert.equal(saved.body.data.subtotal, '26500.00');
    assert.equal(saved.body.data.gstAmount, '4770.00');
    assert.equal(saved.body.data.grandTotal, '31270.00');
    assert.deepEqual(saved.body.data.documents, [], 'BillBuilderPage reads bill.documents (not documentIds) to render the uploaded list');

    const uploaded = await api.post(`/api/v1/gst-filings/${t.filingId}/bill/documents`).set(client).send({
      documents: [{ fileName: 'E2E_Client_Bill.pdf', mimeType: 'application/pdf', contentBase64: b64('client-bill-bytes') }],
    });
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.body.data.documents.length, 1);
    assert.equal(uploaded.body.data.documents[0].fileName, 'E2E_Client_Bill.pdf');
    const docId = uploaded.body.data.documents[0].id;

    const streamed = await api.get(`/api/v1/gst-filings/${t.filingId}/bill/documents/${docId}`).set(client);
    assert.equal(streamed.status, 200);
    assert.equal(Buffer.from(streamed.body).toString('utf8'), 'client-bill-bytes');
  });

  // ---- VendorGstBillsPage: vendor sees the uploaded bill ------------------------------------------------
  await t.test('VendorGstBillsPage flow: GET /vendors/me/gst-bills -> GET bill document', async () => {
    const res = await api.get('/api/v1/vendors/me/gst-bills').set(vendor);
    assert.equal(res.status, 200);
    const row = res.body.data.items.find((i) => i.filingId === t.filingId);
    assert.ok(row, 'the uploaded client bill must appear in the vendor list');
    assert.equal(row.companyName, 'E2E Traders Pvt Ltd');
    assert.equal(row.gstin, '29ABCDE1234F1Z5');
    assert.equal(row.documents.length, 1);

    const streamed = await api.get(`/api/v1/gst-filings/${t.filingId}/bill/documents/${row.documents[0].id}`).set(vendor);
    assert.equal(streamed.status, 200);
  });

  // ---- TallyMatchingPage: configure Tally, run matching, upload final document --------------------------
  await t.test('TallyMatchingPage flow: configure Tally -> GET tally-matching (404 empty) -> POST run -> POST final-document -> GET final-documents', async () => {
    const config = await api.post('/api/v1/tally/config').set(client).send({
      enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: mock.url, companyName: 'E2E Traders Pvt Ltd',
      salesLedger: 'Sales', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', timeoutMs: 2000,
    });
    assert.equal(config.status, 200);

    const emptyMatch = await api.get(`/api/v1/gst-filings/${t.filingId}/tally-matching`).set(vendor);
    assert.equal(emptyMatch.status, 404, 'TallyMatchingPage shows "Run Tally Match" in this state');

    mock.state.vouchers = [
      { voucherNumber: 'TALLY-1001', narration: 'Website Development', amount: '25000' },
      { voucherNumber: 'TALLY-1002', narration: 'Domain Registration', amount: '1500' },
    ];
    const run = await api.post(`/api/v1/gst-filings/${t.filingId}/tally-matching/run`).set(vendor).send();
    assert.equal(run.status, 200);
    assert.equal(run.body.data.overallStatus, 'FULLY_MATCHED');
    assert.equal(run.body.data.matchedCount, 2);
    assert.equal(run.body.data.totalClientBills, 2);
    assert.ok(Array.isArray(run.body.data.results) && run.body.data.results.length === 2, 'TallyMatchingPage renders results[]');

    const finalDoc = await api.post(`/api/v1/gst-filings/${t.filingId}/final-document`).set(vendor).send({
      documents: [{ fileName: 'E2E_Final_Document.pdf', mimeType: 'application/pdf', contentBase64: b64('final-doc-bytes') }],
    });
    assert.equal(finalDoc.status, 200);
    assert.equal(finalDoc.body.data.finalDocuments.length, 1, 'TallyMatchingPage reads data.finalDocuments after upload');
    assert.equal(finalDoc.body.data.finalDocuments[0].fileName, 'E2E_Final_Document.pdf');

    const list = await api.get(`/api/v1/gst-filings/${t.filingId}/final-documents`).set(vendor);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.items.length, 1, 'TallyMatchingPage also independently lists final docs via data.items');
  });

  // ---- GstBillingDashboardPage: client views the result -------------------------------------------------
  await t.test('GstBillingDashboardPage flow: GET business-profile -> GET filing -> GET final-documents -> GET tally-matching -> download', async () => {
    const [profile, filing, finalDocs, match] = await Promise.all([
      api.get('/api/v1/business-profile').set(client),
      api.get(`/api/v1/gst-filings/${t.filingId}`).set(client),
      api.get(`/api/v1/gst-filings/${t.filingId}/final-documents`).set(client),
      api.get(`/api/v1/gst-filings/${t.filingId}/tally-matching`).set(client),
    ]);
    assert.equal(profile.status, 200);
    assert.equal(filing.status, 200);
    assert.ok(filing.body.data.periodKey, 'GstBillingDashboardPage reads filing.periodKey/periodLabel/returnType');
    assert.equal(finalDocs.status, 200);
    assert.equal(finalDocs.body.data.items.length, 1);
    assert.equal(match.status, 200);
    assert.equal(match.body.data.overallStatus, 'FULLY_MATCHED');

    const doc = finalDocs.body.data.items[0];
    const download = await api.get(`/api/v1/gst-filings/${t.filingId}/final-documents/${doc.id}`).set(client);
    assert.equal(download.status, 200);
    assert.equal(Buffer.from(download.body).toString('utf8'), 'final-doc-bytes');
  });

  // ---- GstPage (main workspace): the single progress endpoint ------------------------------------------
  await t.test('GstPage flow: GET /gst-filings/progress reflects the fully-completed workflow', async () => {
    const res = await api.get('/api/v1/gst-filings/progress').set(client);
    assert.equal(res.status, 200);
    const item = res.body.data.items.find((i) => i.filingId === t.filingId);
    assert.ok(item, 'GstPage renders one card per item in data.items');
    assert.equal(item.companyName, 'E2E Traders Pvt Ltd');
    assert.equal(item.status, 'Completed');
    assert.equal(item.progressPercent, 100);
    assert.deepEqual(item.steps, {
      companyDetails: true, billCreated: true, billUploaded: true, tallyMatched: true, finalDocument: true,
    });
    assert.equal(item.finalDocumentCount, 1);
    assert.equal(res.body.data.summary.completed >= 1, true);
  });
});
