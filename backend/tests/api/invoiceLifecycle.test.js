import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('invoice lifecycle, snapshots, numbering, RBAC', async (t) => {
  const h = await createHarness();
  const { api, A, B } = h;
  const admin = h.bearer((await h.login(A.admin.email)).token);
  const staff = h.bearer((await h.login(A.staff.email)).token);

  const mkInvoice = (extra = {}) => ({
    customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true,
    items: [{ productId: String(A.product._id), quantity: '3' }], ...extra,
  });

  await t.test('DRAFT -> ISSUED: totals are recomputed and the invoice becomes immutable', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    assert.equal(draft.invoiceStatus, 'DRAFT');

    const patched = await api.patch(`/api/v1/invoices/${draft._id}`).set(admin).send(mkInvoice({ items: [{ productId: String(A.product._id), quantity: '5' }] }));
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.subtotal, '500.00');

    const issued = await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send();
    assert.equal(issued.status, 200);
    assert.equal(issued.body.data.invoiceStatus, 'ISSUED');
    assert.ok(issued.body.data.issuedAt);
    assert.equal(issued.body.data.issuedBy, String((await api.get('/api/v1/auth/me').set(admin)).body.data.id ?? issued.body.data.issuedBy));

    // ISSUED: no longer editable.
    const blocked = await api.patch(`/api/v1/invoices/${draft._id}`).set(admin).send(mkInvoice());
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'INVOICE_NOT_DRAFT');

    // Double-issue is rejected.
    const again = await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send();
    assert.equal(again.status, 409);
  });

  await t.test('ISSUED -> CANCELLED is allowed; CANCELLED is terminal (no further issue/cancel/update)', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send();
    const cancelled = await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({ reason: 'Order returned by customer' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.invoiceStatus, 'CANCELLED');
    assert.ok(cancelled.body.data.cancelledAt);
    assert.equal(cancelled.body.data.cancellationReason, 'Order returned by customer');

    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).status, 409);
    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({ reason: 'again' })).status, 409);
    assert.equal((await api.patch(`/api/v1/invoices/${draft._id}`).set(admin).send(mkInvoice())).status, 409);
  });

  await t.test('DRAFT -> CANCELLED is allowed directly (no issue required)', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    const cancelled = await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({ reason: 'Created by mistake' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.invoiceStatus, 'CANCELLED');
  });

  await t.test('cancel requires a reason', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({})).status, 400);
    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(admin).send({ reason: 'okay' })).status, 200);
  });

  await t.test('invoice numbering is unique per tenant and assigned server-side only (never trusted from the client)', async () => {
    const withForgedNumber = await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ invoiceNumber: 'INV-FORGED' }));
    assert.equal(withForgedNumber.status, 400, 'unknown field rejected by strict schema');
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => api.post('/api/v1/invoices').set(admin).send(mkInvoice())));
    assert.ok(concurrent.every((r) => r.status === 201));
    const numbers = concurrent.map((r) => r.body.data.invoiceNumber);
    assert.equal(new Set(numbers).size, numbers.length, 'no duplicate invoice numbers under concurrent creation');
  });

  await t.test('historical snapshot: issuing an invoice freezes customer/product/supplier data against later edits', async () => {
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    const issued = (await api.post(`/api/v1/invoices/${draft._id}/issue`).set(admin).send()).body.data;
    assert.equal(issued.customerSnapshot.name, A.customer.name);
    assert.equal(issued.supplierSnapshot.businessName, A.businessProfile.displayName);
    assert.equal(issued.items[0].productCode, A.product.productCode);

    await api.patch(`/api/v1/customers/${A.customer._id}`).set(admin).send({ name: 'Renamed Customer' });
    await api.patch(`/api/v1/products/${A.product._id}`).set(admin).send({ productName: 'Renamed Product' });
    await api.patch('/api/v1/business-profile').set(admin).send({ displayName: 'Renamed Business' });

    const refetched = await api.get(`/api/v1/invoices/${draft._id}`).set(admin);
    assert.equal(refetched.body.data.customerSnapshot.name, A.customer.name, 'customer snapshot unchanged after customer edit');
    assert.equal(refetched.body.data.items[0].productName, A.product.productName, 'product snapshot unchanged after product edit');
    assert.equal(refetched.body.data.supplierSnapshot.businessName, A.businessProfile.displayName, 'supplier snapshot unchanged after business profile edit');
  });

  await t.test('RBAC: invoices.issue / invoices.cancel are distinct, grantable permissions', async () => {
    const draftForNoPerm = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    const noPerm = await api.post(`/api/v1/invoices/${draftForNoPerm._id}/issue`).set(staff).send();
    assert.equal(noPerm.status, 403);
    await api.patch(`/api/v1/users/${A.staff._id}`).set(admin).send({ grantedPermissions: ['products.view', 'customers.view', 'invoices.view', 'invoices.issue', 'invoices.cancel'] });
    const staffToken = h.bearer((await h.login(A.staff.email)).token);
    const draft = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/issue`).set(staffToken).send()).status, 200, 'granted invoices.issue now works');
    assert.equal((await api.post(`/api/v1/invoices/${draft._id}/cancel`).set(staffToken).send({ reason: 'granted cancel' })).status, 200);
  });

  await t.test('tenant isolation on new endpoints: cross-tenant issue/update rejected', async () => {
    const other = await api.patch(`/api/v1/invoices/${B.invoice._id}`).set(admin).send(mkInvoice());
    assert.ok([403, 404].includes(other.status));
    const issueOther = await api.post(`/api/v1/invoices/${B.invoice._id}/issue`).set(admin).send();
    assert.ok([403, 404].includes(issueOther.status));
  });

  await t.test('GST_VENDOR cannot create/update/issue/cancel invoices', async () => {
    const vendorLogin = h.bearer((await h.login(h.vendorUser.email)).token);
    assert.equal((await api.post('/api/v1/invoices').set(vendorLogin).send(mkInvoice())).status, 403);
    assert.equal((await api.post(`/api/v1/invoices/${A.invoice._id}/issue`).set(vendorLogin).send()).status, 403);
    assert.equal((await api.post(`/api/v1/invoices/${A.invoice._id}/cancel`).set(vendorLogin).send({ reason: 'x' })).status, 403);
  });

  await t.test('creating an invoice without a Business Profile is rejected with a clear error, not a crash', async () => {
    const fresh = await h.mkTenant('NOPROFILE', { withInvoice: false });
    const freshAdmin = h.bearer((await h.login(fresh.admin.email)).token);
    const customer = (await api.post('/api/v1/customers').set(freshAdmin).send({ name: 'Cust' })).body.data;
    const product = (await api.post('/api/v1/products').set(freshAdmin).send({ productName: 'Item', sellingPrice: '10' })).body.data;
    const res = await api.post('/api/v1/invoices').set(freshAdmin).send({
      customerId: customer._id, invoiceDate: '2026-04-05', gstApplicable: false, items: [{ productId: product._id, quantity: '1' }],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /[Bb]usiness profile/);
  });

  await t.test('malformed ObjectId on invoice routes returns 400, not 500', async () => {
    assert.equal((await api.get('/api/v1/invoices/not-an-object-id').set(admin)).status, 400);
    assert.equal((await api.post('/api/v1/invoices/not-an-object-id/issue').set(admin).send()).status, 400);
    assert.equal((await api.patch('/api/v1/invoices/not-an-object-id').set(admin).send(mkInvoice())).status, 400);
  });

  await t.test('zero quantity and invalid GST rate are rejected', async () => {
    assert.equal((await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ items: [{ productId: String(A.product._id), quantity: '0' }] }))).status, 400);
    assert.equal((await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ items: [{ productId: String(A.product._id), quantity: '1', gstRate: 150 }] }))).status, 400);
  });
});
