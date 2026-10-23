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
  /**
   * `letterhead`, when supplied, is the already-resolved object DocumentService builds from the invoice's
   * frozen `letterheadSnapshot` (see document.service.js#resolveLetterhead): `{ logo, background,
   * watermark, signature, seal, qrCode }` (each either `null` or `{ buffer, mimeType }`) plus
   * `bankDetails`/`footerText`/`declaration`/`authorizedSignatoryName`/`authorizedSignatoryDesignation`.
   * Every field is optional — a tenant that never configured a letterhead renders exactly as before.
   */
  generate(invoice, letterhead = null) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 36 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      try {
        this.#render(doc, invoice, letterhead);
        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Full-bleed background image, drawn first so every other element sits on top of it (pdfkit z-order). */
  #renderBackground(doc, letterhead) {
    if (!letterhead?.background) return;
    try {
      doc.save().image(letterhead.background.buffer, 0, 0, { fit: [doc.page.width, doc.page.height], align: 'center', valign: 'center' }).restore();
    } catch { /* a corrupt/unsupported image must never block the rest of the invoice from rendering */ }
  }

  /** Faint, centered image watermark — distinct from (and layered under) the DRAFT/CANCELLED text watermark below. */
  #renderWatermark(doc, letterhead) {
    if (!letterhead?.watermark) return;
    try {
      const size = 260;
      doc.save().opacity(0.12)
        .image(letterhead.watermark.buffer, (doc.page.width - size) / 2, (doc.page.height - size) / 2, { fit: [size, size], align: 'center', valign: 'center' })
        .opacity(1).restore();
    } catch { /* ignore */ }
  }

  /** Bank details / QR code / footer text / declaration / signature+seal — rendered after the terms section, in document flow (not absolutely bottom-pinned, so it never overlaps a long items table). */
  #renderFooterBlock(doc, letterhead) {
    if (!letterhead) return;
    const { bankDetails, footerText, declaration, authorizedSignatoryName, authorizedSignatoryDesignation, signature, seal, qrCode } = letterhead;
    const hasBank = bankDetails && Object.values(bankDetails).some(Boolean);
    const hasSignatoryBlock = signature || seal || authorizedSignatoryName;

    if (hasBank || qrCode) {
      doc.moveDown(0.6).fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text('Bank details', 36);
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
      if (hasBank) {
        if (bankDetails.accountName) doc.text(`Account name: ${bankDetails.accountName}`, 36);
        if (bankDetails.accountNumber) doc.text(`Account number: ${bankDetails.accountNumber}`, 36);
        if (bankDetails.ifsc) doc.text(`IFSC: ${bankDetails.ifsc}`, 36);
        if (bankDetails.bankName || bankDetails.branch) doc.text([bankDetails.bankName, bankDetails.branch].filter(Boolean).join(', '), 36);
      }
      if (qrCode) {
        try { doc.image(qrCode.buffer, doc.page.width - doc.page.margins.right - 70, doc.y - 45, { fit: [60, 60] }); } catch { /* ignore */ }
      }
    }

    if (hasSignatoryBlock) {
      doc.moveDown(0.8);
      const sigY = doc.y;
      if (seal) { try { doc.image(seal.buffer, 36, sigY, { fit: [55, 55] }); } catch { /* ignore */ } }
      if (signature) { try { doc.image(signature.buffer, doc.page.width - doc.page.margins.right - 140, sigY, { fit: [140, 45] }); } catch { /* ignore */ } }
      doc.fontSize(8).font('Helvetica').fillColor('#0f172a')
        .text('For ' + (letterhead.supplierBusinessName ?? ''), doc.page.width - doc.page.margins.right - 140, sigY + 48, { width: 140, align: 'center' });
      if (authorizedSignatoryName) doc.font('Helvetica-Bold').text(authorizedSignatoryName, doc.page.width - doc.page.margins.right - 140, doc.y, { width: 140, align: 'center' });
      if (authorizedSignatoryDesignation) doc.font('Helvetica').fontSize(7).text(authorizedSignatoryDesignation, doc.page.width - doc.page.margins.right - 140, doc.y, { width: 140, align: 'center' });
    }

    if (footerText) {
      doc.moveDown(0.6).fontSize(7).font('Helvetica').fillColor('#555').text(footerText, 36, doc.y, { width: 523, align: 'center' }).fillColor('black');
    }
    if (declaration) {
      doc.moveDown(0.4).fontSize(7).font('Helvetica-Oblique').fillColor('#555').text(declaration, 36, doc.y, { width: 523 }).fillColor('black');
    }
  }

  #render(doc, invoice, letterhead) {
    const { supplierSnapshot: sup = {}, customerSnapshot: cust = {}, invoiceStatus } = invoice;
    const startY = doc.page.margins.top;

    // 1. Background and Watermarks (isolated so cursor doc.y is never permanently displaced)
    this.#renderBackground(doc, letterhead);
    this.#renderWatermark(doc, letterhead);

    if (invoiceStatus === 'DRAFT') {
      doc.save().rotate(-35, { origin: [300, 400] })
        .fillColor('#d0021b').opacity(0.22).fontSize(56)
        .text('DRAFT — NOT AN OFFICIAL INVOICE', 20, 380, { width: 600, align: 'center' })
        .opacity(1).fillColor('black').restore();
    }
    if (invoiceStatus === 'CANCELLED') {
      doc.save().rotate(-35, { origin: [300, 400] })
        .fillColor('#d0021b').opacity(0.25).fontSize(80)
        .text('CANCELLED', 20, 380, { width: 600, align: 'center' })
        .opacity(1).fillColor('black').restore();
    }

    // Explicitly reset doc cursor coordinates to top margin
    doc.y = startY;
    doc.x = doc.page.margins.left;

    // 2. Top Header: Logo & Supplier on Left, Boxed Tax Invoice Badge & Metadata on Right
    let compY = startY;
    if (letterhead?.logo) {
      try {
        doc.image(letterhead.logo.buffer, 36, startY, { fit: [140, 44] });
        compY = startY + 50;
      } catch {
        compY = startY;
      }
    }

    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0f172a').text(sup.businessName ?? 'Supplier', 36, compY, { width: 310 });
    doc.fontSize(8).font('Helvetica').fillColor('#475569');
    if (line(sup.address)) doc.text(line(sup.address), 36, doc.y, { width: 310 });
    doc.text(`GSTIN: ${sup.gstin ?? '—'}  |  State code: ${sup.stateCode ?? '—'}`);
    const contact = [sup.email, sup.mobile].filter(Boolean).join('  |  ');
    if (contact) doc.text(contact, 36, doc.y, { width: 310 });
    const leftHeaderBottom = doc.y;

    // Right Header: TAX INVOICE Badge + Invoice Number & Dates
    const badgeX = 355;
    const badgeW = 204;
    doc.rect(badgeX, startY, badgeW, 24).fillColor('#f8fafc').fill();
    doc.rect(badgeX, startY, badgeW, 24).strokeColor('#cbd5e1').stroke();
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11).text('TAX INVOICE', badgeX, startY + 6, { width: badgeW, align: 'center' });

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#0f172a').text(`Invoice Number # ${invoice.invoiceNumber}`, badgeX, startY + 32, { width: badgeW, align: 'right' });
    doc.fontSize(8).font('Helvetica').fillColor('#475569');
    doc.text(`Invoice Date: ${invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString('en-IN') : '—'}`, badgeX, doc.y, { width: badgeW, align: 'right' });
    if (invoice.dueDate) {
      doc.text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString('en-IN')}`, badgeX, doc.y, { width: badgeW, align: 'right' });
    }
    if (invoice.placeOfSupplyStateCode) {
      doc.text(`Place of Supply: ${invoice.placeOfSupplyStateCode}`, badgeX, doc.y, { width: badgeW, align: 'right' });
    }
    const rightHeaderBottom = doc.y;

    // Divider Line separating header from invoice body
    const headerBottom = Math.max(leftHeaderBottom, rightHeaderBottom) + 8;
    doc.moveTo(36, headerBottom).lineTo(559, headerBottom).lineWidth(1.5).strokeColor('#2563eb').stroke();
    doc.lineWidth(1).strokeColor('#cbd5e1');

    // 3. Buyer / Bill To Section
    const billY = headerBottom + 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#64748b').text('BILL TO', 36, billY);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(cust.businessName ?? cust.name ?? '—', 36, billY + 11, { width: 320 });
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    if (line(cust.billingAddress)) doc.text(line(cust.billingAddress), 36, doc.y, { width: 320 });
    doc.text(`GSTIN: ${cust.gstin ?? '—'}  |  PAN: ${cust.pan ?? '—'}`);
    doc.text(`State code: ${cust.stateCode ?? '—'}`);
    const billBottom = doc.y;

    // 4. Items Table
    const cols = [
      { key: '#', w: 20 },
      { key: 'Product Title', w: 135 },
      { key: 'HSN', w: 40 },
      { key: 'Qty', w: 25 },
      { key: 'Rate', w: 45 },
      { key: 'Discount', w: 40 },
      { key: 'Taxable', w: 50 },
      { key: 'CGST', w: 36 },
      { key: 'SGST', w: 36 },
      { key: 'IGST', w: 36 },
      { key: 'Total', w: 55 },
    ];
    const tableHeaderY = billBottom + 10;
    doc.rect(36, tableHeaderY - 2, 523, 16).fillColor('#f8fafc').fill();
    doc.rect(36, tableHeaderY - 2, 523, 16).strokeColor('#e2e8f0').stroke();

    doc.fillColor('#0f172a').fontSize(7.5).font('Helvetica-Bold');
    let x = 36;
    cols.forEach((c) => {
      doc.text(c.key, x, tableHeaderY + 2, { width: c.w, align: 'left' });
      x += c.w;
    });

    doc.y = tableHeaderY + 18;
    doc.font('Helvetica').fontSize(7.5).fillColor('#1e293b');
    for (const item of invoice.items ?? []) {
      x = 36;
      const rowY = doc.y;
      const row = [
        String(item.lineNo),
        item.productName ?? item.description ?? '—',
        item.hsnSacCode ?? '—',
        String(item.quantity),
        money(item.unitPrice),
        money(item.discount ?? 0),
        money(item.taxableAmount),
        money(item.cgst),
        money(item.sgst),
        money(item.igst),
        money(item.lineTotal),
      ];
      row.forEach((val, i) => {
        doc.text(val, x, rowY, { width: cols[i].w, align: 'left' });
        x += cols[i].w;
      });
      doc.moveDown(0.3);
    }

    doc.moveDown(0.3);
    doc.moveTo(36, doc.y).lineTo(559, doc.y).strokeColor('#cbd5e1').stroke();

    // 5. Tax Breakdown + Boxed Grand Total Summary
    doc.moveDown(0.5);
    const summaryY = doc.y;
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text(`Total items: ${invoice.items?.length ?? 0}`, 36, summaryY);
    if (Number(invoice.totalTax) > 0) {
      doc.font('Helvetica-Bold').fontSize(8).text('GST Breakdown:', 36, summaryY + 13);
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
        .text(`Taxable Value: ₹${money(invoice.taxableAmount)}  |  CGST: ₹${money(invoice.cgst)}  |  SGST: ₹${money(invoice.sgst)}  |  IGST: ₹${money(invoice.igst)}  |  Total Tax: ₹${money(invoice.totalTax)}`, 36, summaryY + 24, { width: 310 });
    }

    // Grand Total Box on Right
    const grandBoxX = 355;
    const grandBoxW = 204;
    doc.rect(grandBoxX, summaryY, grandBoxW, 30).fillColor('#f8fafc').fill();
    doc.rect(grandBoxX, summaryY, grandBoxW, 30).strokeColor('#0f172a').stroke();
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(11)
      .text('Grand Total', grandBoxX + 10, summaryY + 8, { width: 90 })
      .text(`₹ ${money(invoice.grandTotal)}`, grandBoxX + 90, summaryY + 8, { width: 104, align: 'right' });

    doc.y = Math.max(doc.y, summaryY + 38);

    // 6. Notes & Terms
    if (invoice.notes || invoice.termsAndConditions) {
      doc.moveDown(0.6).fontSize(8).font('Helvetica-Bold').fillColor('#0f172a').text('Notes & Terms', 36);
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
      if (invoice.notes) doc.text(invoice.notes, 36, doc.y, { width: 523 });
      if (invoice.termsAndConditions) doc.text(`Terms: ${invoice.termsAndConditions}`, 36, doc.y, { width: 523 });
    }

    if (invoiceStatus === 'CANCELLED') {
      doc.moveDown(0.6).fontSize(8.5).fillColor('#d0021b').font('Helvetica-Bold')
        .text(`This invoice was CANCELLED on ${invoice.cancelledAt ? new Date(invoice.cancelledAt).toLocaleDateString('en-IN') : '—'}. Reason: ${invoice.cancellationReason ?? '—'}`, 36, doc.y, { width: 523 })
        .fillColor('black');
    }

    this.#renderFooterBlock(doc, letterhead && { ...letterhead, supplierBusinessName: sup.businessName });

    // 7. Footer: Set bottom margin to 0 temporarily so PDFKit never breaks to Page 2
    const oldBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(7).font('Helvetica').fillColor('#64748b')
      .text('E. & O.E. page 1 of 1', 36, doc.page.height - 24, { width: 523, align: 'right', lineBreak: false })
      .fillColor('black');
    doc.page.margins.bottom = oldBottomMargin;
  }
}
