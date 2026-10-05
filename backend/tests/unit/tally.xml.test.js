import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { buildVoucherRequestXml, buildBillJobPayload } from '../../src/integrations/tally/tally.payloadBuilder.js';

const baseIntegration = { companyName: 'Test Co', salesLedger: 'Sales Account', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', roundOffLedger: 'Round Off' };
const baseMapped = {
  voucherType: 'Sales', voucherDate: '20260401', invoiceNumber: 'INV-0001', partyLedger: 'Customer',
  narration: 'Invoice INV-0001', buyerName: 'Customer', buyerGstin: '27AAAAA0000A1Z5', supplierGstin: '27BBBBB1111B1Z5',
  taxableAmount: '1000.00', cgst: '90.00', sgst: '90.00', igst: '0.00', roundOff: '0.00', grandTotal: '1180.00',
  items: [{ productName: 'Widget', hsnSacCode: '8421', quantity: '2', unitPrice: '500.00', taxableAmount: '1000.00' }],
};

const parseAndValidate = (xml) => {
  const validation = XMLValidator.validate(xml);
  assert.equal(validation, true, typeof validation === 'object' ? JSON.stringify(validation.err) : validation);
  return new XMLParser({ ignoreAttributes: false }).parse(xml);
};

test('Tally XML compatibility: escaping and well-formedness (Phase 14)', async (t) => {
  await t.test('plain values round-trip and the document is well-formed', () => {
    const xml = buildVoucherRequestXml(baseIntegration, baseMapped);
    const parsed = parseAndValidate(xml);
    const voucher = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
    assert.equal(voucher.VOUCHERNUMBER, 'INV-0001');
    assert.equal(voucher.PARTYGSTIN, '27AAAAA0000A1Z5');
  });

  const injectionCases = [
    ['ampersand', 'Sharma & Sons'],
    ['double quote', 'The "Best" Store'],
    ['apostrophe', "O'Brien Traders"],
    ['less-than / greater-than (XML injection attempt)', '<VOUCHER ACTION="Create">injected</VOUCHER> & <evil>'],
    ['CDATA injection attempt', ']]><evil>payload</evil><![CDATA['],
    ['closing-tag injection attempt', 'Name</PARTYLEDGERNAME><INJECTED>hacked</INJECTED><PARTYLEDGERNAME>'],
  ];
  for (const [label, value] of injectionCases) {
    await t.test(`special/malicious characters in party ledger name: ${label}`, () => {
      const xml = buildVoucherRequestXml(baseIntegration, { ...baseMapped, partyLedger: value });
      const parsed = parseAndValidate(xml);
      const voucher = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
      // The value must come back EXACTLY as given (proves it was escaped as text, not interpreted as markup)
      // and the ledger-entries list must still contain exactly the ledgers we built, not an injected sibling.
      assert.equal(String(voucher['ALLLEDGERENTRIES.LIST'][0].LEDGERNAME), value);
      assert.ok(!xml.includes('<INJECTED>'));
      assert.ok(!xml.includes('<evil>'));
    });
  }

  await t.test('Unicode: Kannada and Hindi customer/product names survive round-trip', () => {
    const kannada = 'ಶರ್ಮಾ ಮತ್ತು ಸನ್ಸ್';
    const hindi = 'शर्मा एंड संस';
    const xml = buildVoucherRequestXml(baseIntegration, {
      ...baseMapped, partyLedger: kannada, buyerName: hindi,
      items: [{ ...baseMapped.items[0], productName: 'उत्पाद ವಸ್ತು' }],
    });
    const parsed = parseAndValidate(xml);
    const voucher = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
    assert.equal(String(voucher['ALLLEDGERENTRIES.LIST'][0].LEDGERNAME), kannada);
    assert.equal(String(voucher.BASICBUYERNAME), hindi);
    assert.equal(String(voucher['ALLINVENTORYENTRIES.LIST'].STOCKITEMNAME), 'उत्पाद ವಸ್ತು');
  });

  await t.test('GSTIN and HSN/SAC values pass through unmodified (alphanumeric, no escaping needed but must not be mangled)', () => {
    const xml = buildVoucherRequestXml(baseIntegration, {
      ...baseMapped, buyerGstin: '29AABCU9603R1ZM', items: [{ ...baseMapped.items[0], hsnSacCode: '998314' }],
    });
    const parsed = parseAndValidate(xml);
    const voucher = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
    assert.equal(voucher.PARTYGSTIN, '29AABCU9603R1ZM');
    assert.equal(String(voucher['ALLINVENTORYENTRIES.LIST'].HSNCODE), '998314');
  });

  await t.test('invoice number and address-like narration containing XML-sensitive characters stay well-formed', () => {
    const xml = buildVoucherRequestXml(baseIntegration, { ...baseMapped, invoiceNumber: 'INV/2026/Q1-<1>', narration: 'Flat No. 4 & 5, "MG Road", Bengaluru' });
    const parsed = parseAndValidate(xml);
    const voucher = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER;
    assert.equal(voucher.VOUCHERNUMBER, 'INV/2026/Q1-<1>');
    assert.equal(voucher.NARRATION, 'Flat No. 4 & 5, "MG Road", Bengaluru');
  });

  await t.test('multiple items and ledger lines all escape independently (no cross-contamination between entries)', () => {
    const xml = buildVoucherRequestXml(baseIntegration, {
      ...baseMapped,
      items: [
        { productName: 'Item <A>', hsnSacCode: '1111', quantity: '1', unitPrice: '10.00', taxableAmount: '10.00' },
        { productName: 'Item & B', hsnSacCode: '2222', quantity: '1', unitPrice: '20.00', taxableAmount: '20.00' },
      ],
    });
    const parsed = parseAndValidate(xml);
    const items = parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER['ALLINVENTORYENTRIES.LIST'];
    assert.equal(items.length, 2);
    assert.equal(String(items[0].STOCKITEMNAME), 'Item <A>');
    assert.equal(String(items[1].STOCKITEMNAME), 'Item & B');
  });

  // Phase 17: ledger-mapping extension — discountLedger is optional and additive.
  await t.test('discountLedger: posted only when both a non-zero discount AND a configured discountLedger exist', () => {
    const withoutConfig = buildVoucherRequestXml(baseIntegration, { ...baseMapped, discount: '50.00' });
    const parsedWithout = parseAndValidate(withoutConfig);
    const linesWithout = [].concat(parsedWithout.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER['ALLLEDGERENTRIES.LIST']);
    assert.ok(!linesWithout.some((l) => String(l.LEDGERNAME).includes('Discount')), 'no discount ledger line when unset (backward compatible)');

    const withConfig = buildVoucherRequestXml({ ...baseIntegration, discountLedger: 'Discount Allowed' }, { ...baseMapped, discount: '50.00' });
    const parsedWith = parseAndValidate(withConfig);
    const linesWith = [].concat(parsedWith.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER['ALLLEDGERENTRIES.LIST']);
    const discountLine = linesWith.find((l) => String(l.LEDGERNAME) === 'Discount Allowed');
    assert.ok(discountLine, 'discount ledger line present when configured');
    assert.equal(Number(discountLine.AMOUNT), -50);

    const zeroDiscount = buildVoucherRequestXml({ ...baseIntegration, discountLedger: 'Discount Allowed' }, { ...baseMapped, discount: '0.00' });
    const parsedZero = parseAndValidate(zeroDiscount);
    const linesZero = [].concat(parsedZero.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER['ALLLEDGERENTRIES.LIST']);
    assert.ok(!linesZero.some((l) => String(l.LEDGERNAME) === 'Discount Allowed'), 'no line when discount is zero even if configured');
  });

  await t.test('discount ledger name escapes special characters like any other ledger entry', () => {
    const xml = buildVoucherRequestXml({ ...baseIntegration, discountLedger: 'Discount & <Promo> "Scheme"' }, { ...baseMapped, discount: '25.00' });
    const parsed = parseAndValidate(xml);
    const lines = [].concat(parsed.ENVELOPE.BODY.IMPORTDATA.REQUESTDATA.TALLYMESSAGE.VOUCHER['ALLLEDGERENTRIES.LIST']);
    const line = lines.find((l) => String(l.LEDGERNAME) === 'Discount & <Promo> "Scheme"');
    assert.ok(line, 'escaped value round-trips back to the exact original string once parsed');
  });

  await t.test('buildBillJobPayload: ledgerMapping only includes fields the tenant actually configured (never invented)', () => {
    const bill = { _id: 'b1', billNumber: 'BILL-1', billDate: '2026-04-01', vendorName: 'V', amount: '100.00' };
    const unconfigured = buildBillJobPayload(bill, { companyName: 'Co' });
    assert.deepEqual(unconfigured.ledgerMapping, {}, 'nothing configured -> empty mapping, matching Phase 16 fallback');

    const configured = buildBillJobPayload(bill, {
      companyName: 'Co', cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', roundOffLedger: 'Round Off', discountLedger: 'Discount', salesLedger: 'Sales Account',
    });
    // salesLedger is deliberately NOT part of the bill-side mapping (a purchase voucher has no configured
    // "purchase ledger" field in this phase — see payloadBuilder.js comment — so it must not leak in here).
    assert.deepEqual(configured.ledgerMapping, {
      cgstLedger: 'CGST', sgstLedger: 'SGST', igstLedger: 'IGST', roundOffLedger: 'Round Off', discountLedger: 'Discount',
    });
  });
});
