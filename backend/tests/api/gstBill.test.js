import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('Phase 19: GST Bill Builder — ownership, validation, calculation, upload', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const aStaff = h.bearer((await h.login(A.staff.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);

  const createFilingForA = async (periodKey) => {
    const res = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey, returnType: 'GSTR_1' });
    assert.equal(res.status, 201);
    return res.body.data;
  };

  // ---- RBAC / ownership ---------------------------------------------------------------------
  await t.test('Client Admin can create a bill for their own filing', async () => {
    const filing = await createFilingForA('2026-08');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({
      items: [{ productName: 'Website Development', rate: '25000' }],
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items.length, 1);
    assert.equal(res.body.data.items[0].serialNo, 1);
    assert.equal(String(res.body.data.filingId), String(filing._id));
  });

  await t.test('Client User cannot create/update a bill (RBAC: gst_bills.update is not a CLIENT_USER default)', async () => {
    const filing = await createFilingForA('2026-09');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aStaff).send({
      items: [{ productName: 'Consulting', rate: '1000' }],
    });
    assert.equal(res.status, 403);
  });

  await t.test('cannot create a bill for another tenant\'s filing (filingId is verified server-side)', async () => {
    const filing = await createFilingForA('2026-10');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(bAdmin).send({
      items: [{ productName: 'Hack', rate: '1' }],
    });
    assert.equal(res.status, 403);
  });

  await t.test('cannot access another tenant\'s bill', async () => {
    const filing = await createFilingForA('2026-11');
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '10' }] });
    const res = await api.get(`/api/v1/gst-filings/${filing._id}/bill`).set(bAdmin);
    assert.equal(res.status, 403);
  });

  // ---- validation ----------------------------------------------------------------------------
  await t.test('product name validation: empty name rejected', async () => {
    const filing = await createFilingForA('2026-12');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: '   ', rate: '100' }] });
    assert.equal(res.status, 400);
  });

  await t.test('rate validation: missing/invalid rate rejected', async () => {
    const filing = await createFilingForA('2027-01');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: 'abc' }] });
    assert.equal(res.status, 400);
  });

  await t.test('negative rate rejected', async () => {
    const filing = await createFilingForA('2027-02');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '-5' }] });
    assert.equal(res.status, 400);
  });

  await t.test('zero rate rejected', async () => {
    const filing = await createFilingForA('2027-03');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '0' }] });
    assert.equal(res.status, 400);
  });

  await t.test('empty product list rejected', async () => {
    const filing = await createFilingForA('2027-04');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [] });
    assert.equal(res.status, 400);
  });

  await t.test('client-sent subtotal/gstAmount/finalTotal are never trusted — rejected as unrecognized fields', async () => {
    const filing = await createFilingForA('2027-05');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({
      items: [{ productName: 'Item', rate: '100' }], subtotal: '999999', gstAmount: '0', finalTotal: '0',
    });
    assert.equal(res.status, 400);
  });

  // ---- calculation -----------------------------------------------------------------------------
  await t.test('multiple products save correctly; serial numbers sequential; subtotal/GST/final total calculated correctly', async () => {
    const filing = await createFilingForA('2027-06');
    const res = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({
      items: [
        { productName: 'Website Development', rate: '10000' },
        { productName: 'Domain Registration', rate: '5000' },
      ],
    });
    assert.equal(res.status, 200);
    const bill = res.body.data;
    assert.equal(bill.items.length, 2);
    assert.deepEqual(bill.items.map((i) => i.serialNo), [1, 2]);
    assert.equal(bill.gstRate, 18);
    assert.equal(bill.subtotal, '15000.00');
    assert.equal(bill.gstAmount, '2700.00');
    assert.equal(bill.grandTotal, '17700.00');
  });

  // ---- load / update without duplication ---------------------------------------------------
  await t.test('existing bill loads; updating saves in place without creating a duplicate', async () => {
    const filing = await createFilingForA('2027-07');
    const first = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({
      items: [
        { productName: 'Product A', rate: '100' },
        { productName: 'Product B', rate: '200' },
        { productName: 'Product C', rate: '300' },
      ],
    });
    assert.equal(first.status, 200);
    const billId = first.body.data._id;

    const loaded = await api.get(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin);
    assert.equal(loaded.status, 200);
    assert.equal(loaded.body.data._id, billId);
    assert.equal(loaded.body.data.items.length, 3);

    // Deleting "Product B" and resaving must renumber remaining items sequentially (1, 2) and update the
    // SAME bill row in place — never create a second GSTBill document for this filing.
    const second = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({
      items: [
        { productName: 'Product A', rate: '100' },
        { productName: 'Product C', rate: '300' },
      ],
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.data._id, billId, 'update must reuse the same bill document, never duplicate it');
    assert.equal(second.body.data.items.length, 2);
    assert.deepEqual(second.body.data.items.map((i) => i.serialNo), [1, 2]);
    assert.deepEqual(second.body.data.items.map((i) => i.productName), ['Product A', 'Product C']);
    assert.equal(second.body.data.subtotal, '400.00');

    const reloaded = await api.get(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin);
    assert.equal(reloaded.body.data._id, billId);
    assert.equal(reloaded.body.data.items.length, 2);
  });

  await t.test('a failed (invalid) save never corrupts the previously saved bill', async () => {
    const filing = await createFilingForA('2027-08');
    const good = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Good Item', rate: '500' }] });
    assert.equal(good.status, 200);

    const bad = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Bad Item', rate: '-1' }] });
    assert.equal(bad.status, 400);

    const stillGood = await api.get(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin);
    assert.equal(stillGood.body.data.items.length, 1);
    assert.equal(stillGood.body.data.items[0].productName, 'Good Item');
  });

  // ---- upload --------------------------------------------------------------------------------
  await t.test('upload is associated with the correct filing/bill; requires the bill to exist first', async () => {
    const filing = await createFilingForA('2027-09');
    const beforeSave = await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({
      documents: [{ fileName: 'bill.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('hello').toString('base64') }],
    });
    assert.equal(beforeSave.status, 400, 'uploading before the bill is saved must fail cleanly');

    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '100' }] });
    const uploaded = await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(aAdmin).send({
      documents: [{ fileName: 'bill.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('hello').toString('base64') }],
    });
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.body.data.documents.length, 1);
    assert.equal(uploaded.body.data.documents[0].fileName, 'bill.pdf');

    const docId = uploaded.body.data.documents[0].id;
    const fetched = await api.get(`/api/v1/gst-filings/${filing._id}/bill/documents/${docId}`).set(aAdmin);
    assert.equal(fetched.status, 200);
    assert.equal(Buffer.from(fetched.body).toString('utf8'), 'hello');
  });

  await t.test('upload cannot be attached to another tenant\'s filing', async () => {
    const filing = await createFilingForA('2027-10');
    await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(aAdmin).send({ items: [{ productName: 'Item', rate: '100' }] });
    const res = await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(bAdmin).send({
      documents: [{ fileName: 'evil.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') }],
    });
    assert.equal(res.status, 403);
  });

  // ---- unauthenticated -------------------------------------------------------------------------
  await t.test('unauthenticated requests are denied', async () => {
    const filing = await createFilingForA('2027-11');
    assert.equal((await api.get(`/api/v1/gst-filings/${filing._id}/bill`)).status, 401);
    assert.equal((await api.put(`/api/v1/gst-filings/${filing._id}/bill`).send({ items: [] })).status, 401);
  });
});

test('Phase 19.3: client bill handoff to vendor — GET /vendors/me/gst-bills + authorized document access', async (t) => {
  const h = await createHarness();
  const {
    api, A, B, master, vendor, vendorUser,
  } = h;
  const m = h.bearer((await h.login(master.email)).token);
  const aAdmin = h.bearer((await h.login(A.admin.email)).token);
  const bAdmin = h.bearer((await h.login(B.admin.email)).token);
  const v = h.bearer((await h.login(vendorUser.email)).token);

  // vendor2: an unrelated GST_VENDOR, not assigned to any tenant in this test.
  const { formatCode } = await import('../../src/utils/codes.js');
  const { ID_PREFIX } = await import('../../src/constants/pagination.js');
  const { hashPassword } = await import('../../src/security/password.js');
  const vendor2Code = formatCode(ID_PREFIX.vendor, await h.repos.counters.next(null, 'vendor'));
  const vendor2 = await h.repos.vendors.create({ vendorCode: vendor2Code, name: 'Vendor Two', status: 'ACTIVE' });
  const vendor2User = await h.repos.users.createUnscoped({
    vendorId: vendor2._id, name: 'Vendor Two User', email: 'vendor2@example.test', passwordHash: await hashPassword('Dev-Only-Pass-123'), role: 'GST_VENDOR', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0,
  });
  const v2 = h.bearer((await h.login(vendor2User.email)).token);

  // vendor (h.vendor) is ACTIVE-assigned only to tenant A (see harness.js). Assign it to a third tenant C too,
  // to prove the vendor list aggregates across ALL of its assigned clients, not just one.
  const C = await h.mkTenant('C');
  await api.post(`/api/v1/vendors/${vendor._id}/assignments`).set(m).send({ tenantId: String(C.tenant._id) });

  const createFilingAndUploadBill = async (adminHeader, periodKey, productName, fileName) => {
    const filingRes = await api.post('/api/v1/gst-filings').set(adminHeader).send({ periodKey, returnType: 'GSTR_1' });
    assert.equal(filingRes.status, 201);
    const filing = filingRes.body.data;
    const billRes = await api.put(`/api/v1/gst-filings/${filing._id}/bill`).set(adminHeader).send({ items: [{ productName, rate: '1000' }] });
    assert.equal(billRes.status, 200);
    const uploadRes = await api.post(`/api/v1/gst-filings/${filing._id}/bill/documents`).set(adminHeader).send({
      documents: [{ fileName, mimeType: 'application/pdf', contentBase64: Buffer.from(fileName).toString('base64') }],
    });
    assert.equal(uploadRes.status, 200);
    return { filing, docId: uploadRes.body.data.documents[0].id };
  };

  const aBill = await createFilingAndUploadBill(aAdmin, '2028-01', 'A Product', 'a-bill.pdf');
  const cAdmin = h.bearer((await h.login(C.admin.email)).token);
  const cRealBill = await createFilingAndUploadBill(cAdmin, '2028-02', 'C Product', 'c-bill.pdf');

  // A filing with NO uploaded document — must be excluded from the vendor list (spec step 17).
  const noDocFilingRes = await api.post('/api/v1/gst-filings').set(aAdmin).send({ periodKey: '2028-03', returnType: 'GSTR_1' });
  assert.equal(noDocFilingRes.status, 201);
  await api.put(`/api/v1/gst-filings/${noDocFilingRes.body.data._id}/bill`).set(aAdmin).send({ items: [{ productName: 'No doc yet', rate: '1' }] });

  // B's filing/bill — vendor is never assigned to B.
  const bBill = await createFilingAndUploadBill(bAdmin, '2028-01', 'B Product', 'b-bill.pdf');

  await t.test('authorized vendor lists exactly the uploaded bills of its assigned clients (A and C), not B, and excludes the no-document filing', async () => {
    const res = await api.get('/api/v1/vendors/me/gst-bills').set(v);
    assert.equal(res.status, 200);
    const { items } = res.body.data;
    assert.equal(items.length, 2);
    const byFiling = Object.fromEntries(items.map((i) => [String(i.filingId), i]));
    assert.ok(byFiling[String(aBill.filing._id)]);
    assert.ok(byFiling[String(cRealBill.filing._id)]);
    assert.ok(!byFiling[String(bBill.filing._id)], 'vendor must never see tenant B\'s bill');

    const aRow = byFiling[String(aBill.filing._id)];
    assert.equal(aRow.companyId, A.tenant.tenantCode);
    assert.equal(aRow.companyName, A.businessProfile.displayName);
    assert.equal(aRow.gstin, A.businessProfile.gstin);
    assert.equal(aRow.documents.length, 1);
    assert.equal(aRow.documents[0].fileName, 'a-bill.pdf');
    // No internal storage path / password / token data ever leaves the service.
    assert.equal(aRow.documents[0].storageKey, undefined);
    assert.equal(aRow.password, undefined);
  });

  await t.test('an unrelated vendor (no assignments) gets an empty list', async () => {
    const res = await api.get('/api/v1/vendors/me/gst-bills').set(v2);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data.items, []);
  });

  await t.test('vendor can securely retrieve an authorized document; cannot by using a document id across tenants', async () => {
    const ok = await api.get(`/api/v1/gst-filings/${aBill.filing._id}/bill/documents/${aBill.docId}`).set(v);
    assert.equal(ok.status, 200);
    assert.equal(Buffer.from(ok.body).toString('utf8'), 'a-bill.pdf');

    // Swap in tenant B's own real document id against tenant A's filing (bare documentId is never sufficient authorization).
    const crossDoc = await api.get(`/api/v1/gst-filings/${aBill.filing._id}/bill/documents/${bBill.docId}`).set(v);
    assert.equal(crossDoc.status, 404);
  });

  await t.test('vendor not assigned to tenant B is denied, even with a valid B filing id', async () => {
    const res = await api.get(`/api/v1/gst-filings/${bBill.filing._id}/bill`).set(v);
    assert.equal(res.status, 403);
    const doc = await api.get(`/api/v1/gst-filings/${bBill.filing._id}/bill/documents/${bBill.docId}`).set(v);
    assert.equal(doc.status, 403);
  });

  await t.test('an unrelated vendor cannot access another vendor\'s assigned client bill by filing id', async () => {
    const res = await api.get(`/api/v1/gst-filings/${aBill.filing._id}/bill`).set(v2);
    assert.equal(res.status, 403);
  });

  await t.test('vendor cannot modify or upload/replace a client\'s bill (read-only workflow)', async () => {
    const put = await api.put(`/api/v1/gst-filings/${aBill.filing._id}/bill`).set(v).send({ items: [{ productName: 'Tampered', rate: '1' }] });
    assert.equal(put.status, 403);
    const upload = await api.post(`/api/v1/gst-filings/${aBill.filing._id}/bill/documents`).set(v).send({
      documents: [{ fileName: 'replace.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('x').toString('base64') }],
    });
    assert.equal(upload.status, 403);
  });

  await t.test('client\'s own existing bill permissions are unaffected by vendor read access', async () => {
    assert.equal((await api.get(`/api/v1/gst-filings/${aBill.filing._id}/bill`).set(aAdmin)).status, 200);
    const aStaff = h.bearer((await h.login(A.staff.email)).token);
    assert.equal((await api.put(`/api/v1/gst-filings/${aBill.filing._id}/bill`).set(aStaff).send({ items: [] })).status, 403);
  });

  await t.test('MASTER_ADMIN retains existing full access to a bill (unaffected by Phase 3)', async () => {
    const res = await api.get(`/api/v1/gst-filings/${aBill.filing._id}/bill`).set({ ...m, 'X-Admin-Tenant-Id': String(A.tenant._id) });
    assert.equal(res.status, 200);
  });

  await t.test('unauthenticated request to the vendor list is denied', async () => {
    assert.equal((await api.get('/api/v1/vendors/me/gst-bills')).status, 401);
  });
});
