import React from 'react';
import { formatMoney, formatDate } from '../utils/format.js';

/**
 * LDS v1.0 PrintPreview Component
 * Wraps content with print controls and page layout container.
 */
export function PrintPreview({ children, onPrint, title = 'Document Preview', className = '' }) {
  const handlePrint = () => {
    if (onPrint) onPrint();
    else window.print();
  };

  return (
    <div className={`lds-print-container ${className}`.trim()}>
      <div className="lds-print-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ margin: 0, fontSize: '18px' }}>{title}</h2>
        <button type="button" className="btn btn--primary" onClick={handlePrint}>
          🖨️ Print / Save as PDF
        </button>
      </div>
      <div className="lds-printable-page" style={{ background: '#FFFFFF', padding: '2rem', border: '1px solid var(--line-default)', borderRadius: 'var(--radius-sm)' }}>
        {children}
      </div>
    </div>
  );
}

/**
 * LDS v1.0 InvoiceViewer Component
 * GST-compliant enterprise tax invoice printable layout.
 */
export function InvoiceViewer({ invoice }) {
  if (!invoice) return null;

  return (
    <div className="lds-invoice-preview" style={{ fontFamily: 'var(--sans)', color: '#0F172A', maxWidth: 800, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0F172A', paddingBottom: '1rem', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800 }}>TAX INVOICE</h1>
          <p style={{ margin: '4px 0 0 0', fontSize: '14px', color: '#64748B' }}>Original for Recipient</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)' }}>{invoice.invoiceNumber}</div>
          <div style={{ fontSize: '13px', color: '#64748B' }}>Date: {formatDate(invoice.invoiceDate)}</div>
        </div>
      </div>

      {/* Supplier & Customer Information */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
        <div style={{ padding: '1rem', background: '#F8FAFC', borderRadius: '4px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: '4px' }}>Supplier / Billed From</div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{invoice.supplierSnapshot?.businessName ?? '—'}</div>
          <div style={{ fontSize: '13px', marginTop: '2px' }}>GSTIN: <strong style={{ fontFamily: 'var(--mono)' }}>{invoice.supplierSnapshot?.gstin ?? '—'}</strong></div>
          <div style={{ fontSize: '13px' }}>State: {invoice.supplierSnapshot?.stateCode ?? '—'}</div>
        </div>
        <div style={{ padding: '1rem', background: '#F8FAFC', borderRadius: '4px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B', marginBottom: '4px' }}>Customer / Billed To</div>
          <div style={{ fontWeight: 700, fontSize: '15px' }}>{invoice.customerSnapshot?.name ?? '—'}</div>
          <div style={{ fontSize: '13px', marginTop: '2px' }}>GSTIN: <strong style={{ fontFamily: 'var(--mono)' }}>{invoice.customerSnapshot?.gstin ?? '—'}</strong></div>
          <div style={{ fontSize: '13px' }}>Code: {invoice.customerSnapshot?.customerCode ?? '—'}</div>
        </div>
      </div>

      {/* Items Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1.5rem', fontSize: '13px' }}>
        <thead>
          <tr style={{ background: '#F1F5F9', borderBottom: '1px solid #CBD5E1' }}>
            <th style={{ padding: '8px', textAlign: 'left' }}>Item</th>
            <th style={{ padding: '8px', textAlign: 'left' }}>HSN</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Unit Price</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Taxable</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>GST</th>
            <th style={{ padding: '8px', textAlign: 'right' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items?.map((it, idx) => {
            const tax = (Number(it.cgst || 0) + Number(it.sgst || 0) + Number(it.igst || 0)).toFixed(2);
            return (
              <tr key={idx} style={{ borderBottom: '1px solid #E2E8F0' }}>
                <td style={{ padding: '8px' }}>{it.productName ?? it.description}</td>
                <td style={{ padding: '8px', fontFamily: 'var(--mono)' }}>{it.hsnSacCode ?? '—'}</td>
                <td style={{ padding: '8px', textAlign: 'right' }}>{it.quantity}</td>
                <td style={{ padding: '8px', textAlign: 'right' }}>{formatMoney(it.unitPrice)}</td>
                <td style={{ padding: '8px', textAlign: 'right' }}>{formatMoney(it.taxableAmount)}</td>
                <td style={{ padding: '8px', textAlign: 'right' }}>{formatMoney(tax)}</td>
                <td style={{ padding: '8px', textAlign: 'right', fontWeight: 600 }}>{formatMoney(it.lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Summary Totals */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
        <div style={{ width: '280px', fontSize: '13.5px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>Subtotal:</span>
            <span>{formatMoney(invoice.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>Discount:</span>
            <span>{formatMoney(invoice.discount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>Taxable Amount:</span>
            <span>{formatMoney(invoice.taxableAmount)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
            <span>Total GST:</span>
            <span>{formatMoney(invoice.totalTax)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid #0F172A', fontWeight: 700, fontSize: '16px' }}>
            <span>Grand Total:</span>
            <span>{formatMoney(invoice.grandTotal)}</span>
          </div>
        </div>
      </div>

      {/* Signature & Terms */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #E2E8F0' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#64748B' }}>Terms & Notes</div>
          <p style={{ fontSize: '12px', color: '#334155', margin: '4px 0' }}>{invoice.termsAndConditions || 'Payment due within 15 days of invoice date.'}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ height: '50px' }} />
          <div style={{ fontSize: '12px', fontWeight: 600, borderTop: '1px solid #0F172A', display: 'inline-block', paddingTop: '4px', minWidth: '180px', textAlign: 'center' }}>
            Authorised Signatory
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * LDS v1.0 LetterheadPreview Component
 */
export function LetterheadPreview({
  companyName = 'LauncherDesk Enterprise',
  logoUrl = '/brand/launcherdesk-full.png',
  children,
}) {
  return (
    <div className="lds-letterhead-preview" style={{ fontFamily: 'var(--sans)', background: '#FFFFFF', padding: '2.5rem', maxWidth: 800, margin: '0 auto', minHeight: '800px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid var(--primary)', paddingBottom: '1rem', marginBottom: '2rem' }}>
          <img src={logoUrl} alt={companyName} style={{ height: '38px', objectFit: 'contain' }} />
          <div style={{ textAlign: 'right', fontSize: '12px', color: '#64748B' }}>
            <div>Corporate Identification</div>
            <div>Official Enterprise Documentation</div>
          </div>
        </div>
        <div className="lds-letterhead-content">
          {children}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: '1rem', textAlign: 'center', fontSize: '11px', color: '#94A3B8' }}>
        Generated via LauncherDesk Enterprise ERP Portal · Confirmed Authentic
      </div>
    </div>
  );
}

export default {
  PrintPreview,
  InvoiceViewer,
  LetterheadPreview,
};
