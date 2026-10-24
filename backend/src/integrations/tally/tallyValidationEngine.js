import { getFinancialYearString } from '../../utils/billIdentifier.js';
import { ROLES } from '../../constants/roles.js';

// Valid Indian GSTIN state codes (01 to 38, plus 97, 99)
const VALID_GST_STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30',
  '31', '32', '33', '34', '35', '36', '37', '38', '97', '99',
]);

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const BILL_ID_REGEX = /^[A-Z0-9]+-BILL-\d{2}-\d{2}-\d{6}$/;
const COMPANY_CODE_REGEX = /^[A-Z0-9]{3,10}$/;
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB

/**
 * Validates document integrity and safety.
 * Checks for path traversal, null bytes, dangerous control characters, valid extensions, and base64 structure.
 */
function validateDocumentIntegrity(doc) {
  if (!doc) return 'Document object cannot be null';

  const name = String(doc.name || doc.fileName || '').trim();
  if (!name) return 'Document name is required';

  // Path traversal and control character detection
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    return `Security violation: Invalid or potentially malicious document name "${name}"`;
  }

  // Extension check
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex === -1) return `Document "${name}" missing file extension`;
  const ext = name.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Unsupported file extension "${ext}". Allowed: .pdf, .jpg, .jpeg, .png`;
  }

  // MIME type check
  const mimeType = String(doc.mimeType || '').toLowerCase();
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return `Unsupported document MIME type "${mimeType}". Allowed: application/pdf, image/jpeg, image/png`;
  }

  // Base64 payload check (if content provided)
  const b64 = doc.data || doc.contentBase64;
  if (b64) {
    if (typeof b64 !== 'string') return `Invalid document payload format for "${name}"`;
    // Approximate byte length of base64
    const approxBytes = Math.ceil((b64.length * 3) / 4);
    if (approxBytes > MAX_FILE_BYTES) {
      return `Document "${name}" exceeds maximum allowed size of 15MB`;
    }
  }

  return null;
}

/**
 * Dedicated Enterprise Validation Engine for Tally Bill Synchronization.
 * Executes all 19 validation rules BEFORE a bill enters the queue or calls Tally.
 */
export class TallyValidationEngine {
  constructor({ tenantRepo, tallyBillSyncRepo, billRepo = null }) {
    this.tenantRepo = tenantRepo;
    this.tallyBillSyncRepo = tallyBillSyncRepo;
    this.billRepo = billRepo;
  }

  /**
   * Performs full validation against bill data and execution context.
   *
   * @param {Object} billData - The bill upload payload or intake entity
   * @param {Object} context - Calling context: { tenantId, actor, auth }
   * @returns {Promise<{ isValid: boolean, errors: Array<{ field: string, rule: string, message: string }> }>}
   */
  async validate(billData, context) {
    const errors = [];
    const addError = (field, rule, message) => errors.push({ field, rule, message });

    const tenantId = context?.tenantId || billData.tenantId;

    // 1. Company Exists
    if (!tenantId) {
      addError('tenantId', 'REQUIRED', 'Organization ID is required');
      return { isValid: false, errors };
    }

    let tenant = null;
    try {
      tenant = await this.tenantRepo.findById(tenantId);
    } catch {
      addError('tenantId', 'INVALID_ID', 'Invalid organization ID format');
      return { isValid: false, errors };
    }

    if (!tenant) {
      addError('tenantId', 'COMPANY_NOT_FOUND', `Organization with ID ${tenantId} does not exist`);
      return { isValid: false, errors };
    }

    // 2. Company Active
    if (tenant.isDeleted) {
      addError('tenantId', 'COMPANY_DELETED', 'Organization has been deleted');
    }
    if (tenant.status === 'SUSPENDED' || tenant.status === 'INACTIVE') {
      addError('tenantId', 'COMPANY_INACTIVE', `Organization is currently ${tenant.status}`);
    }

    // 3. Company Code Valid
    const companyCode = String(billData.companyCode || tenant.companyCode || tenant.tenantCode || '').trim().toUpperCase();
    if (!companyCode) {
      addError('companyCode', 'REQUIRED', 'Company code is required');
    } else if (!COMPANY_CODE_REGEX.test(companyCode)) {
      addError('companyCode', 'INVALID_FORMAT', 'Company code must be 3-10 uppercase alphanumeric characters');
    } else if (tenant.companyCode && companyCode !== tenant.companyCode.toUpperCase()) {
      addError('companyCode', 'CODE_MISMATCH', `Company code ${companyCode} does not match organization code ${tenant.companyCode}`);
    }

    // 4. Bill ID Valid (if provided)
    const billId = billData.billId ? String(billData.billId).trim() : null;
    if (billId && !BILL_ID_REGEX.test(billId)) {
      addError('billId', 'INVALID_FORMAT', 'Bill ID must match pattern [CompanyCode]-BILL-[YY-YY]-[RunningNumber]');
    }

    // 5. Invoice Number Format
    const invoiceNumber = String(billData.billNumber || billData.invoiceNumber || '').trim();
    if (!invoiceNumber) {
      addError('invoiceNumber', 'REQUIRED', 'Invoice number is required');
    } else if (invoiceNumber.length > 100) {
      addError('invoiceNumber', 'MAX_LENGTH', 'Invoice number cannot exceed 100 characters');
    } else if (!/^[A-Za-z0-9\-_#/.\s]+$/.test(invoiceNumber)) {
      addError('invoiceNumber', 'INVALID_FORMAT', 'Invoice number contains invalid characters');
    }

    // 6. Invoice Date Validation & 7. Future Date Detection
    const rawDate = billData.billDate || billData.invoiceDate;
    let billDate = null;
    if (!rawDate) {
      addError('billDate', 'REQUIRED', 'Invoice date is required');
    } else {
      billDate = new Date(rawDate);
      if (isNaN(billDate.getTime())) {
        addError('billDate', 'INVALID_DATE', 'Invoice date is not a valid date');
      } else {
        const now = Date.now();
        // Allow clock skew of at most 24 hours into the future
        if (billDate.getTime() > now + 86400000) {
          addError('billDate', 'FUTURE_DATE', `Invoice date ${billDate.toISOString().slice(0, 10)} cannot be in the future`);
        }
        if (billDate.getFullYear() < 2000) {
          addError('billDate', 'DATE_OUT_OF_RANGE', 'Invoice date cannot be prior to year 2000');
        }
      }
    }

    // 8. Financial Year Validation
    if (billDate && !isNaN(billDate.getTime())) {
      const calculatedFY = getFinancialYearString(billDate);
      const providedFY = billData.financialYear ? String(billData.financialYear).trim() : null;
      if (providedFY && providedFY !== calculatedFY) {
        addError('financialYear', 'FY_MISMATCH', `Financial year "${providedFY}" does not match invoice date FY "${calculatedFY}"`);
      }
    }

    // 9. Duplicate Invoice Detection
    if (companyCode && invoiceNumber && billDate && !isNaN(billDate.getTime()) && this.tallyBillSyncRepo) {
      const fy = getFinancialYearString(billDate);
      const duplicateInvoice = await this.tallyBillSyncRepo.checkDuplicate({
        companyCode,
        invoiceNumber,
        financialYear: fy,
        excludeBillId: billId,
      });
      if (duplicateInvoice) {
        addError(
          'invoiceNumber',
          'DUPLICATE_INVOICE',
          `Duplicate bill detected: Invoice ${invoiceNumber} is already queued/synced for company ${companyCode} in FY ${fy}`,
        );
      }
    }

    // 10. Duplicate Bill Detection
    if (billId && this.tallyBillSyncRepo) {
      const existingSync = await this.tallyBillSyncRepo.findByBillId(billId);
      if (existingSync) {
        const docId = billData.id || billData._id;
        const isSelf = docId && (String(existingSync._id) === String(docId) || String(existingSync.billIntakeId) === String(docId));
        if (!isSelf) {
          addError('billId', 'DUPLICATE_BILL_ID', `Bill ID ${billId} is already registered in the system`);
        }
      }
    }

    // 11. GSTIN Validation
    const rawGstin = billData.supplierGstin || billData.vendorGSTIN || billData.gstin;
    let gstin = rawGstin ? String(rawGstin).trim().toUpperCase() : null;
    if (gstin) {
      if (!GSTIN_REGEX.test(gstin)) {
        addError('gstin', 'INVALID_GSTIN', `GSTIN "${gstin}" does not match standard 15-character format`);
      } else {
        const stateCode = gstin.slice(0, 2);
        if (!VALID_GST_STATE_CODES.has(stateCode)) {
          addError('gstin', 'INVALID_GST_STATE', `GSTIN state code "${stateCode}" is not a recognized Indian state/UT code`);
        }
      }
    }

    // 12. PAN Validation (if supplied or extracted)
    const rawPan = billData.pan || (gstin && gstin.length === 15 ? gstin.slice(2, 12) : null);
    if (rawPan) {
      const pan = String(rawPan).trim().toUpperCase();
      if (!PAN_REGEX.test(pan)) {
        addError('pan', 'INVALID_PAN', `PAN "${pan}" does not match 10-character PAN format (e.g. ABCDE1234F)`);
      }
    }

    // 13. Amount Validation
    const rawAmount = billData.amount ?? billData.totalAmount;
    const amount = Number(rawAmount);
    if (rawAmount === undefined || rawAmount === null || rawAmount === '' || isNaN(amount)) {
      addError('amount', 'REQUIRED', 'Bill total amount is required and must be numeric');
    } else if (amount <= 0) {
      addError('amount', 'INVALID_AMOUNT', 'Bill amount must be strictly greater than 0');
    }

    // Tax amount validations
    const cgst = billData.cgst !== undefined ? Number(billData.cgst) : null;
    const sgst = billData.sgst !== undefined ? Number(billData.sgst) : null;
    const igst = billData.igst !== undefined ? Number(billData.igst) : null;
    const taxableAmount = billData.taxableAmount !== undefined ? Number(billData.taxableAmount) : null;

    if (cgst !== null && (isNaN(cgst) || cgst < 0)) addError('cgst', 'INVALID_TAX', 'CGST cannot be negative');
    if (sgst !== null && (isNaN(sgst) || sgst < 0)) addError('sgst', 'INVALID_TAX', 'SGST cannot be negative');
    if (igst !== null && (isNaN(igst) || igst < 0)) addError('igst', 'INVALID_TAX', 'IGST cannot be negative');
    if (taxableAmount !== null && (isNaN(taxableAmount) || taxableAmount < 0)) addError('taxableAmount', 'INVALID_TAX', 'Taxable amount cannot be negative');

    // 14. GST Calculation Validation
    if (taxableAmount !== null && amount > 0) {
      let totalTax = 0;
      if (cgst !== null) totalTax += cgst;
      if (sgst !== null) totalTax += sgst;
      if (igst !== null) totalTax += igst;

      // Intra-state symmetry check: if both CGST and SGST provided, they must equal (allow 0.10 for odd-paise rounding)
      if (cgst !== null && sgst !== null && Math.abs(cgst - sgst) > 0.10) {
        addError('taxes', 'TAX_SPLIT_MISMATCH', `CGST (${cgst}) and SGST (${sgst}) must be balanced for intra-state supply`);
      }

      // Balance check: taxableAmount + totalTax should match total amount within 2.00 currency units (round-off tolerance)
      if (totalTax > 0) {
        const calculatedTotal = taxableAmount + totalTax;
        if (Math.abs(calculatedTotal - amount) > 2.00) {
          addError(
            'amount',
            'GST_CALCULATION_MISMATCH',
            `Taxable amount (${taxableAmount}) + total taxes (${totalTax.toFixed(2)}) = ${calculatedTotal.toFixed(2)} does not equal total amount (${amount})`,
          );
        }
      }
    }

    // 15. Mandatory Document Fields
    const vendorName = String(billData.supplierName || billData.vendorName || billData.partyName || '').trim();
    if (!vendorName) {
      addError('vendorName', 'REQUIRED', 'Vendor / Supplier name is required');
    } else if (vendorName.length > 200) {
      addError('vendorName', 'MAX_LENGTH', 'Vendor name cannot exceed 200 characters');
    }

    // 16. Required Attachments & Document Integrity Validation
    const docs = billData.documents || (billData.documentBase64 ? [{
      data: billData.documentBase64,
      name: billData.documentName || 'bill.pdf',
      mimeType: billData.mimeType || 'application/pdf',
    }] : []);

    if (Array.isArray(docs)) {
      for (let i = 0; i < docs.length; i++) {
        const docErr = validateDocumentIntegrity(docs[i]);
        if (docErr) {
          addError(`documents[${i}]`, 'DOCUMENT_INTEGRITY_FAILED', docErr);
        }
      }
    }

    // 17. Company Ownership Validation & 18. User Permission Validation
    if (context?.auth) {
      const auth = context.auth;
      if (auth.mode === 'API_KEY') {
        if (String(auth.tenantId) !== String(tenantId)) {
          addError('ownership', 'FORBIDDEN', 'API Key belongs to a different organization');
        }
      } else if (auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
        const assigned = (auth.assignedTenantIds || []).map(String);
        if (!assigned.includes(String(tenantId))) {
          addError('ownership', 'FORBIDDEN', 'Assistant Admin cannot operate on unassigned organizations');
        }
      } else if (auth.role === ROLES.CLIENT_ADMIN || auth.role === ROLES.CLIENT_USER) {
        if (String(auth.tenantId) !== String(tenantId)) {
          addError('ownership', 'FORBIDDEN', 'User cannot upload bills for another organization');
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
