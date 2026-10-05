import test from 'node:test';
import assert from 'node:assert/strict';
import { createHarness } from '../helpers/harness.js';

test('products, customers, invoices', async (t) => {
  const h = await createHarness();
  const { api, A } = h;
  const admin = h.bearer((await h.login(A.admin.email)).token);
  const mkInvoice = (extra = {}) => ({
    customerId: String(A.customer._id), invoiceDate: '2026-04-05', gstApplicable: true,
    items: [{ productId: String(A.product._id), quantity: '3' }], ...extra,
  });

  await t.test('product codes are sequential per tenant and validated', async () => {
    const p2 = await api.post('/api/v1/products').set(admin).send({ productName: 'Second', sellingPrice: 49.5, hsnSacCode: '8471' });
    assert.equal(p2.status, 201); assert.equal(p2.body.data.productCode, 'PROD-000002'); assert.equal(p2.body.data.sellingPrice, '49.5');
    assert.equal((await api.post('/api/v1/products').set(admin).send({ productName: 'Bad', sellingPrice: '1.999' })).status, 400);
    assert.equal((await api.post('/api/v1/products').set(admin).send({ productName: 'Bad', sellingPrice: '1', unexpected: true })).status, 400);
    assert.equal((await api.post('/api/v1/products').set(admin).send({ productName: 'Bad', sellingPrice: '1', productCode: 'PROD-999999' })).status, 400);
  });

  await t.test('GST and non-GST invoices compute totals server-side with decimal maths', async () => {
    const gst = await api.post('/api/v1/invoices').set(admin).send(mkInvoice());
    assert.equal(gst.status, 201);
    const d = gst.body.data;
    assert.deepEqual([d.invoiceNumber, d.subtotal, d.cgst, d.sgst, d.igst, d.totalTax, d.grandTotal, d.invoiceStatus], ['INV-000002', '300.00', '27.00', '27.00', '0.00', '54.00', '354.00', 'DRAFT']);
    assert.equal(d.tallySyncStatus, 'NOT_SYNCED'); assert.equal(d.gstFilingStatus, 'PENDING');
    const inter = await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ interState: true }));
    assert.deepEqual([inter.body.data.igst, inter.body.data.cgst, inter.body.data.grandTotal], ['54.00', '0.00', '354.00']);
    const none = await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ gstApplicable: false }));
    assert.deepEqual([none.body.data.totalTax, none.body.data.grandTotal, none.body.data.taxableAmount], ['0.00', '300.00', '300.00']);
    const client = await api.post('/api/v1/invoices').set(admin).send(mkInvoice({ grandTotal: '1' }));
    assert.equal(client.status, 400, 'client cannot supply totals');
  });

  await t.test('idempotency: same key + same body replays; different body conflicts; no duplicate invoice', async () => {
    const key = 'idem-key-12345678';
    const before = h.fake.Invoice.docs.length;
    const first = await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send(mkInvoice());
    const again = await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send(mkInvoice());
    assert.equal(first.status, 201); assert.equal(again.status, 201);
    assert.equal(again.headers['idempotent-replay'], 'true');
    assert.equal(again.body.data.invoiceNumber, first.body.data.invoiceNumber);
    assert.equal(h.fake.Invoice.docs.length, before + 1);
    const conflict = await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send(mkInvoice({ gstApplicable: false }));
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal((await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', 'short').send(mkInvoice())).status, 400);
  });

  await t.test('failed validation does not burn the idempotency key', async () => {
    const key = 'idem-retry-87654321';
    assert.equal((await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send({ ...mkInvoice(), items: [] })).status, 400);
    assert.equal((await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send({ ...mkInvoice(), items: [] })).status, 400);
    assert.equal((await api.post('/api/v1/invoices').set(admin).set('Idempotency-Key', key).send(mkInvoice())).status, 201);
  });

  await t.test('archived products leave lists but invoices keep their snapshot; invoices are cancelled, never deleted', async () => {
    const inv = (await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).body.data;
    const del = await api.delete(`/api/v1/products/${A.product._id}`).set(admin);
    assert.equal(del.status, 200); assert.equal(del.body.data.status, 'ARCHIVED');
    const list = await api.get('/api/v1/products').set(admin);
    assert.ok(!list.body.data.items.some((p) => String(p._id) === String(A.product._id)));
    assert.equal(h.fake.Product.docs.filter((p) => p._id === String(A.product._id)).length, 1, 'record is retained');
    const kept = await api.get(`/api/v1/invoices/${inv._id}`).set(admin);
    assert.equal(kept.body.data.items[0].productCode, 'PROD-000001');
    assert.equal((await api.post('/api/v1/invoices').set(admin).send(mkInvoice())).status, 404, 'archived product cannot be newly invoiced');
    assert.equal((await api.delete(`/api/v1/invoices/${inv._id}`).set(admin)).status, 404, 'no delete route for invoices');
    const cancel = await api.post(`/api/v1/invoices/${inv._id}/cancel`).set(admin).send({ reason: 'Customer requested cancellation' });
    assert.equal(cancel.body.data.invoiceStatus, 'CANCELLED');
    assert.equal((await api.post(`/api/v1/invoices/${inv._id}/cancel`).set(admin).send({ reason: 'Customer requested cancellation' })).status, 409);
    const log = h.fake.AuditLog.docs.find((d) => d.action === 'INVOICE_CANCELLED');
    assert.deepEqual([log.metadata.previous, log.metadata.next], ['DRAFT', 'CANCELLED']);
    assert.ok(['PRODUCT_ARCHIVED', 'INVOICE_CREATED', 'PRODUCT_CREATED'].every((x) => h.fake.AuditLog.docs.some((d) => d.action === x)));
  });

  await t.test('pagination, search, sort, status filter, date range; limit capped at 100', async () => {
    for (let i = 0; i < 25; i += 1) await api.post('/api/v1/customers').set(admin).send({ name: `Bulk ${String(i).padStart(2, '0')}` });
    const p1 = await api.get('/api/v1/customers?limit=10&page=1&sort=name').set(admin);
    assert.equal(p1.body.data.items.length, 10);
    assert.deepEqual(p1.body.data.pagination, { page: 1, limit: 10, total: 26, totalPages: 3 });
    const p3 = await api.get('/api/v1/customers?limit=10&page=3&sort=name').set(admin);
    assert.equal(p3.body.data.items.length, 6);
    assert.equal((await api.get('/api/v1/customers?search=bulk 07').set(admin)).body.data.items.length, 1);
    assert.equal((await api.get('/api/v1/customers?search=.*').set(admin)).body.data.items.length, 0, 'search is escaped');
    assert.equal((await api.get('/api/v1/customers?limit=101').set(admin)).status, 400);
    assert.equal((await api.get('/api/v1/customers?limit=100').set(admin)).status, 200);
    assert.equal((await api.get('/api/v1/customers?status=ARCHIVED').set(admin)).body.data.items.length, 0);
    assert.equal((await api.get('/api/v1/customers?from=2999-01-01').set(admin)).body.data.items.length, 0);
    assert.equal((await api.get('/api/v1/customers?sort=passwordHash').set(admin)).status, 200);
    assert.equal((await api.get('/api/v1/products/not-an-object-id').set(admin)).status, 400);
  });
});
