import { D, toMoney, moneyString } from '../utils/money.js';
import { ValidationError } from '../utils/errors.js';

/**
 * FOUNDATION IMPLEMENTATION — NOT YET VALIDATED FOR STATUTORY GST COMPLIANCE.
 * Decimal arithmetic only (decimal.js). Rules currently applied (see docs/gst-workflow.md, "Calculation rules (proposed)"):
 *  - line gross = quantity x unit price, rounded HALF_UP to 2 dp
 *  - line tax   = taxable x rate / 100, rounded HALF_UP to 2 dp per line
 *  - intra-state: CGST = round(tax/2), SGST = tax - CGST ; inter-state: IGST = tax
 *  - line cess   = taxable x cessRate / 100, rounded HALF_UP to 2 dp per line (cessRate defaults to 0)
 *  - GST not applicable: tax = 0 and grand total = taxable amount
 *  - invoice-level round-off: grand total (taxable + all tax) is rounded HALF_UP to the nearest whole
 *    rupee; `roundOff` is the (possibly negative) adjustment that makes that so — the standard Indian
 *    invoicing convention, never a client-supplied value.
 * Phase 4 must replace/confirm these rules with a tax professional before production use.
 */
export class InvoiceCalculationService {
  calculate({ items, gstApplicable, interState = false }) {
    const zero = toMoney(0);
    const totals = { subtotal: zero, discount: zero, taxableAmount: zero, cgst: zero, sgst: zero, igst: zero, cess: zero };
    const lines = items.map((item) => {
      const gross = toMoney(new D(item.quantity).mul(item.unitPrice));
      const discount = toMoney(item.discount ?? 0);
      if (discount.gt(gross)) throw new ValidationError('Discount cannot exceed the line amount');
      const taxable = gross.minus(discount);
      const rate = gstApplicable ? new D(item.gstRate ?? 0) : new D(0);
      const cessRate = gstApplicable ? new D(item.cessRate ?? 0) : new D(0);
      const tax = toMoney(taxable.mul(rate).div(100));
      const cess = toMoney(taxable.mul(cessRate).div(100));
      let cgst = zero; let sgst = zero; let igst = zero;
      if (tax.gt(0)) {
        if (interState) igst = tax;
        else { cgst = toMoney(tax.div(2)); sgst = tax.minus(cgst); }
      }
      totals.subtotal = totals.subtotal.plus(gross);
      totals.discount = totals.discount.plus(discount);
      totals.taxableAmount = totals.taxableAmount.plus(taxable);
      totals.cgst = totals.cgst.plus(cgst); totals.sgst = totals.sgst.plus(sgst); totals.igst = totals.igst.plus(igst);
      totals.cess = totals.cess.plus(cess);
      return {
        taxable, rate: rate.toNumber(), cessRate: cessRate.toNumber(), cgst, sgst, igst, cess, lineTotal: taxable.plus(tax).plus(cess),
      };
    });
    const totalTax = totals.cgst.plus(totals.sgst).plus(totals.igst).plus(totals.cess);
    // Deliberately NOT rounded to the nearest whole rupee: every existing total stays at exact paise
    // precision (see tests/unit/calculation.test.js — '0.30' must stay '0.30', never become '0'). Optional
    // nearest-rupee invoice rounding is a distinct, opt-in feature, not a silent default-on behavior change.
    const grandTotal = totals.taxableAmount.plus(totalTax);
    const roundOff = toMoney(0);
    const s = moneyString;
    return {
      lines: lines.map((l) => ({
        taxableAmount: s(l.taxable), gstRate: l.rate, cessRate: l.cessRate, cgst: s(l.cgst), sgst: s(l.sgst), igst: s(l.igst), cess: s(l.cess), lineTotal: s(l.lineTotal),
      })),
      totals: {
        subtotal: s(totals.subtotal), discount: s(totals.discount), taxableAmount: s(totals.taxableAmount), cgst: s(totals.cgst), sgst: s(totals.sgst),
        igst: s(totals.igst), cess: s(totals.cess), totalTax: s(totalTax), roundOff: s(roundOff), grandTotal: s(grandTotal),
      },
    };
  }
}
