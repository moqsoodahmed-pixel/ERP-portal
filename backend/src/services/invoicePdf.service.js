import PDFDocument from 'pdfkit';

const money = (v) => Number(v ?? 0).toFixed(2);
const line = (addr) => [addr?.line1, addr?.line2, [addr?.city, addr?.state, addr?.pincode].filter(Boolean).join(', ')].filter(Boolean).join(', ');

/**
 * Renders a GST invoice PDF from an already-persisted, already-serialized invoice object
 * (frozen customerSnapshot/supplierSnapshot/items + authoritative totals computed by invoice.service.js
 * / invoiceCalculation.service.js). This module performs NO GST math and makes NO live Customer/Product/
 * BusinessProfile queries — it only lays out numbers it is handed. That is what guarantees PDF output
 * for an ISSUED/CANCELLED invoice can never drift from the frozen snapshot, no matter what the live
 * Customer/Product/BusinessProfile records say by the time someone views the PDF.
 */
export class InvoicePdfService {
  generate(invoice) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        this.#render(doc, invoice);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  #render(doc, invoice) {
    const { supplierSnapshot: sup = {}, customerSnapshot: cust = {}, invoiceStatus } = invoice;

    if (invoiceStatus === 'DRAFT') {
      doc.save().rotate(-35, { origin: [300, 400] })
        .fillColor('#d0021b').opacity(0.25).fontSize(60)
        .text('DRAFT — NOT AN OFFICIAL INVOICE', 20, 380, { width: 600, align: 'center' })
        .opacity(1).fillColor('black').restore();
    }
    if (invoiceStatus === 'CANCELLED') {
      doc.save().rotate(-35, { origin: [300, 400] })
        .fillColor('#d0021b').opacity(0.3).fontSize(90)
        .text('CANCELLED', 20, 380, { width: 600, align: 'center' })
        .opacity(1).fillColor('black').restore();
    }

    // Header: supplier (from the frozen supplierSnapshot only — never a live Business Profile lookup)
    doc.fontSize(16).font('Helvetica-Bold').text(sup.businessName ?? 'Supplier', { continued: false });
    doc.fontSize(9).font('Helvetica')
      .text(line(sup.address))
      .text(`GSTIN: ${sup.gstin ?? '—'}   State code: ${sup.stateCode ?? '—'}`)
      .text([sup.email, sup.mobile].filter(Boolean).join('  |  '));

    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').text(`TAX INVOICE  ${invoice.invoiceNumber}`);
    doc.fontSize(9).font('Helvetica')
      .text(`Invoice date: ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-IN') : '—'}`)
      .text(`Due date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString('en-IN') : '—'}`)
      .text(`Status: ${invoiceStatus}`);

    doc.moveDown(0.5).fontSize(11).font('Helvetica-Bold').text('Bill to');
    doc.fontSize(9).font('Helvetica')
      .text(cust.businessName ?? cust.name ?? '—')
      .text(line(cust.billingAddress))
      .text(`GSTIN: ${cust.gstin ?? '—'}   PAN: ${cust.pan ?? '—'}   State code: ${cust.stateCode ?? '—'}`);

    doc.moveDown(0.5);
    const cols = [
      { key: '#', w: 20 }, { key: 'Item', w: 110 }, { key: 'HSN', w: 45 }, { key: 'Qty', w: 35 }, { key: 'Rate', w: 50 },
      { key: 'Taxable', w: 55 }, { key: 'GST%', w: 30 }, { key: 'CGST', w: 45 }, { key: 'SGST', w: 45 }, { key: 'IGST', w: 45 }, { key: 'Total', w: 55 },
    ];
    let x = doc.x; const yStart = doc.y;
    doc.fontSize(8).font('Helvetica-Bold');
    cols.forEach((c) => { doc.text(c.key, x, yStart, { width: c.w, align: 'left' }); x += c.w; });
    doc.moveDown(0.3);
    doc.font('Helvetica');
    for (const item of invoice.items ?? []) {
      x = doc.x; const y = doc.y;
      const row = [
        String(item.lineNo), item.productName ?? item.description ?? '—', item.hsnSacCode ?? '—', String(item.quantity),
        money(item.unitPrice), money(item.taxableAmount), String(item.gstRate ?? 0), money(item.cgst), money(item.sgst), money(item.igst), money(item.lineTotal),
      ];
      row.forEach((val, i) => { doc.text(val, x, y, { width: cols[i].w, align: 'left' }); x += cols[i].w; });
      doc.moveDown(0.2);
    }

    doc.moveDown(0.8);
    const totalsX = 360;
    const totalRow = (labelText, value, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(labelText, totalsX, doc.y, { width: 120, continued: true })
        .text(money(value), { width: 80, align: 'right' });
    };
    totalRow('Subtotal', invoice.subtotal);
    totalRow('Discount', invoice.discount);
    totalRow('Taxable amount', invoice.taxableAmount);
    totalRow('CGST', invoice.cgst);
    totalRow('SGST', invoice.sgst);
    totalRow('IGST', invoice.igst);
    totalRow('Total tax', invoice.totalTax);
    totalRow('Round off', invoice.roundOff ?? 0);
    totalRow('Grand total', invoice.grandTotal, true);

    if (invoice.notes || invoice.termsAndConditions) {
      doc.moveDown(1).fontSize(8).font('Helvetica-Bold').text('Notes', 36);
      doc.font('Helvetica').text(invoice.notes ?? '—', 36, doc.y, { width: 520 });
      doc.font('Helvetica-Bold').text('Terms & conditions', 36);
      doc.font('Helvetica').text(invoice.termsAndConditions ?? '—', 36, doc.y, { width: 520 });
    }

    if (invoiceStatus === 'CANCELLED') {
      doc.moveDown(1).fontSize(10).fillColor('#d0021b').font('Helvetica-Bold')
        .text(`This invoice was CANCELLED on ${invoice.cancelledAt ? new Date(invoice.cancelledAt).toLocaleDateString('en-IN') : '—'}. Reason: ${invoice.cancellationReason ?? '—'}`, 36, doc.y, { width: 520 })
        .fillColor('black');
    }
  }
}
