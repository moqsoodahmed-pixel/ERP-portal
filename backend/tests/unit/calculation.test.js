import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceCalculationService } from '../../src/services/invoiceCalculation.service.js';

const svc = new InvoiceCalculationService();
const item = (o = {}) => ({ quantity: '1', unitPrice: '100.00', discount: '0', gstRate: 18, ...o });

test('GST applicable intra-state splits CGST/SGST and adds to total', () => {
  const { totals } = svc.calculate({ items: [item()], gstApplicable: true });
  assert.deepEqual([totals.taxableAmount, totals.cgst, totals.sgst, totals.igst, totals.grandTotal], ['100.00', '9.00', '9.00', '0.00', '118.00']);
});
test('GST applicable inter-state uses IGST only', () => {
  const { totals } = svc.calculate({ items: [item()], gstApplicable: true, interState: true });
  assert.deepEqual([totals.cgst, totals.sgst, totals.igst, totals.grandTotal], ['0.00', '0.00', '18.00', '118.00']);
});
test('GST not applicable: grand total equals taxable amount even if rate is supplied', () => {
  const { totals } = svc.calculate({ items: [item()], gstApplicable: false });
  assert.equal(totals.totalTax, '0.00');
  assert.equal(totals.grandTotal, totals.taxableAmount);
});
test('decimal arithmetic avoids floating point drift (0.1 x 3, 0.07 x 3)', () => {
  assert.equal(svc.calculate({ items: [item({ quantity: '3', unitPrice: '0.10', gstRate: 0 })], gstApplicable: false }).totals.grandTotal, '0.30');
  assert.equal(svc.calculate({ items: [item({ quantity: '3', unitPrice: '0.07', gstRate: 0 })], gstApplicable: false }).totals.grandTotal, '0.21');
});
test('odd paise tax keeps CGST + SGST equal to total tax', () => {
  const { totals } = svc.calculate({ items: [item({ unitPrice: '0.05', gstRate: 5 })], gstApplicable: true });
  assert.equal(totals.totalTax, '0.00');
  const r = svc.calculate({ items: [item({ unitPrice: '10.10', gstRate: 5 })], gstApplicable: true });
  assert.equal(r.totals.totalTax, '0.51');
  assert.equal(r.totals.cgst, '0.26');
  assert.equal(r.totals.sgst, '0.25');
});
test('discount larger than line amount is rejected', () => {
  assert.throws(() => svc.calculate({ items: [item({ discount: '500' })], gstApplicable: true }), /Discount/);
});
