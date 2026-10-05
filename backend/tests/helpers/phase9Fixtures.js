/**
 * Phase 9 known-value fixtures. Every expected number below is hand-computed from the fixture definitions
 * (product price 100.00, GST 18%, intra-state split CGST/SGST 50/50) — NOT read back from the system under test.
 *
 * Tenant A (April 2026 window = 2026-04-01..2026-04-30):
 *   inv1 2026-04-01 qty 2, intra, ISSUED     taxable 200  cgst 18  sgst 18  igst 0   grand 236   (harness fixture invoice)
 *   inv2 2026-04-15 qty 3, INTER, ISSUED     taxable 300  cgst 0   sgst 0   igst 54  grand 354
 *   inv3 2026-04-20 qty 1, intra, DRAFT      taxable 100  cgst 9   sgst 9   igst 0   grand 118
 *   inv4 2026-04-25 qty 5, intra, CANCELLED  taxable 500  cgst 45  sgst 45  igst 0   grand 590   (issued, then cancelled)
 *   inv6 2026-04-10 qty 4, GST N/A, ISSUED   taxable 400  tax 0                      grand 400
 *   inv5 2026-05-02 qty 7, intra, ISSUED     taxable 700  cgst 63  sgst 63  igst 0   grand 826   (outside April)
 * Tally: inv1 SYNCED, inv2 FAILED (TALLY_UNREACHABLE), inv6 no record.
 * Tenant B: its harness invoice (2026-04-01, qty 2) ISSUED -> taxable 200, grand 236.
 */
export const APRIL = { range: 'custom', from: '2026-04-01', to: '2026-04-30' };
export const aprilQuery = 'range=custom&from=2026-04-01&to=2026-04-30';

export const EXPECTED = {
  aprilIssued: { count: 3, taxableAmount: '900.00', cgst: '18.00', sgst: '18.00', igst: '54.00', totalTax: '90.00', totalGst: '90.00', grandTotal: '990.00' },
  aprilByStatus: { DRAFT: 1, ISSUED: 3, CANCELLED: 1 },
  aprilAllTotals: { count: 5, taxableAmount: '1500.00', cgst: '72.00', sgst: '72.00', igst: '54.00', totalTax: '198.00', totalGst: '198.00', grandTotal: '1698.00' },
  aprilTally: { total: 3, synced: 1, failed: 1, pending: 1 },
  gstAprMay: {
    rows: [
      { period: '2026-04', invoiceCount: 3, gstApplicableInvoiceCount: 2, taxableAmount: '900.00', cgst: '18.00', sgst: '18.00', igst: '54.00', totalGst: '90.00' },
      { period: '2026-05', invoiceCount: 1, gstApplicableInvoiceCount: 1, taxableAmount: '700.00', cgst: '63.00', sgst: '63.00', igst: '0.00', totalGst: '126.00' },
    ],
    totals: { invoiceCount: 4, gstApplicableInvoiceCount: 3, taxableAmount: '1600.00', cgst: '81.00', sgst: '81.00', igst: '54.00', totalGst: '216.00' },
  },
  // Issued (non-cancelled) invoices for A's fixture customer: inv1+inv2+inv5+inv6 = 236+354+826+400
  customerIssued: { count: 4, grandTotal: '1816.00' },
  bAprilIssued: { count: 1, taxableAmount: '200.00', grandTotal: '236.00' },
};

export async function buildPhase9Fixtures(h) {
  const { services, repos, A, B } = h;
  const inv = (date, qty, extra = {}) => services.invoiceService.create(A.ctx, {
    customerId: String(A.customer._id), invoiceDate: new Date(date), gstApplicable: true, items: [{ productId: String(A.product._id), quantity: String(qty) }], ...extra,
  });
  const inv1 = A.invoice;
  const inv2 = await inv('2026-04-15', 3, { interState: true });
  const inv3 = await inv('2026-04-20', 1);
  const inv4 = await inv('2026-04-25', 5);
  const inv5 = await inv('2026-05-02', 7);
  const inv6 = await inv('2026-04-10', 4, { gstApplicable: false });
  for (const i of [inv1, inv2, inv4, inv5, inv6]) await services.invoiceService.issue(A.ctx, i._id);
  await services.invoiceService.cancel(A.ctx, inv4._id, 'Fixture cancellation');
  await services.invoiceService.issue(B.ctx, B.invoice._id);

  await repos.tallySyncs.create(A.tenant._id, {
    invoiceId: String(inv1._id), status: 'SYNCED', attempt: 1, voucherNumber: 'SALE-1', startedAt: new Date('2026-04-02T10:00:00Z'), completedAt: new Date('2026-04-02T10:00:05Z'),
  });
  await repos.tallySyncs.create(A.tenant._id, {
    invoiceId: String(inv2._id), status: 'FAILED', attempt: 3, errorCode: 'TALLY_UNREACHABLE', errorMessage: 'Connection refused', startedAt: new Date('2026-04-16T10:00:00Z'), completedAt: new Date('2026-04-16T10:00:09Z'),
  });
  return { inv1, inv2, inv3, inv4, inv5, inv6 };
}
