import mongoose from 'mongoose';
import {
  PRODUCT_STATUS, CUSTOMER_STATUS, INVOICE_STATUS, PAYMENT_STATUS, TALLY_SYNC_STATUS, GST_FILING_STATUS,
  FILING_STATUS, FILING_RETURN_TYPE, FILING_SUBMISSION_SOURCE, FILING_MILESTONE_STATUS,
  FILING_ISSUE_TYPE, FILING_ISSUE_SEVERITY, FILING_ISSUE_STATUS, TALLY_API_KEY_STATUS,
  BILL_STATUS, BILL_TALLY_STATUS, TALLY_CONNECTOR_STATUS, TALLY_JOB_STATUS, TALLY_JOB_TYPE,
  GST_BILL_MATCH_STATUS, GST_BILL_OVERALL_MATCH_STATUS, NOTE_TYPE, NOTE_STATUS,
} from '../constants/statuses.js';
import { TALLY_API_SCOPES, TALLY_CONNECTOR_SCOPES } from '../integrations/tally/tally.constants.js';
import {
  ObjectId, Money, tenantPlugin, softDeletePlugin, actorPlugin, addressSchema, GSTIN_REGEX, PAN_REGEX,
} from './plugins.js';

const { Schema, model } = mongoose;
const enumOf = (o) => Object.values(o);

const productSchema = new Schema({
  productCode: { type: String, required: true },
  type: { type: String, enum: ['PRODUCT', 'SERVICE'], default: 'PRODUCT' },
  productName: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, maxlength: 2000 },
  hsnSacCode: { type: String, match: /^\d{4,8}$/ },
  unit: { type: String, default: 'NOS' },
  sellingPrice: { type: Money, required: true },
  purchasePrice: { type: Money },
  gstRate: { type: Number, min: 0, max: 100, default: 0 },
  isGstApplicable: { type: Boolean, default: false },
  status: { type: String, enum: enumOf(PRODUCT_STATUS), default: PRODUCT_STATUS.ACTIVE },
}, { timestamps: true });
tenantPlugin(productSchema); softDeletePlugin(productSchema); actorPlugin(productSchema);
productSchema.index({ tenantId: 1, productCode: 1 }, { unique: true });
productSchema.index({ tenantId: 1, status: 1 });
productSchema.index({ tenantId: 1, createdAt: -1 });

const customerSchema = new Schema({
  customerCode: { type: String, required: true },
  name: { type: String, required: true, trim: true, maxlength: 200 },
  businessName: { type: String, trim: true },
  gstin: { type: String, uppercase: true, match: GSTIN_REGEX },
  pan: { type: String, uppercase: true, match: PAN_REGEX },
  phone: String,
  email: { type: String, lowercase: true },
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  state: String,
  pincode: String,
  status: { type: String, enum: enumOf(CUSTOMER_STATUS), default: CUSTOMER_STATUS.ACTIVE },
  processingPurpose: { type: String, default: 'INVOICING' },
}, { timestamps: true });
tenantPlugin(customerSchema); softDeletePlugin(customerSchema); actorPlugin(customerSchema);
customerSchema.index({ tenantId: 1, customerCode: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, status: 1 });
customerSchema.index({ tenantId: 1, createdAt: -1 });

/** Embedded line-item snapshot. Product values are copied so history never changes when a product is edited. */
export const invoiceItemSchema = new Schema({
  lineNo: { type: Number, required: true },
  productId: { type: ObjectId, ref: 'Product', required: true },
  productCode: String,
  productName: String,
  description: String,
  hsnSacCode: String,
  unit: String,
  quantity: { type: Money, required: true },
  unitPrice: { type: Money, required: true },
  discount: { type: Money, default: 0 },
  taxableAmount: { type: Money, required: true },
  gstRate: { type: Number, default: 0 },
  cessRate: { type: Number, default: 0 },
  cgst: { type: Money, default: 0 },
  sgst: { type: Money, default: 0 },
  igst: { type: Money, default: 0 },
  cess: { type: Money, default: 0 },
  lineTotal: { type: Money, required: true },
}, { _id: false });

/** Frozen at creation/issue time so later edits to the Customer record never retroactively change history. */
export const customerSnapshotSchema = new Schema({
  name: String,
  businessName: String,
  customerCode: String,
  gstin: String,
  pan: String,
  email: String,
  phone: String,
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  state: String,
  stateCode: String,
  pincode: String,
}, { _id: false });

/** Frozen at creation/issue time so later edits to the Business Profile never retroactively change history. */
export const supplierSnapshotSchema = new Schema({
  businessName: String,
  gstin: String,
  address: addressSchema,
  stateCode: String,
  email: String,
  mobile: String,
}, { _id: false });

/**
 * Phase 22 — Letterhead snapshot. Frozen at invoice-creation time (same "never let a later Business
 * Profile edit retroactively change history" rule as customerSnapshot/supplierSnapshot above): only the
 * FileMetadata *ids* are copied here (not the image bytes themselves — those are fetched through the SAME
 * tenant-scoped FileMetadata/StorageService path used everywhere else, at PDF-render time), so an asset
 * re-uploaded or removed after this invoice was created never changes what this invoice's PDF shows.
 */
const letterheadSnapshotSchema = new Schema({
  logoFileId: ObjectId,
  backgroundFileId: ObjectId,
  watermarkFileId: ObjectId,
  signatureFileId: ObjectId,
  sealFileId: ObjectId,
  qrCodeFileId: ObjectId,
  bankDetails: {
    accountName: String, accountNumber: String, ifsc: String, bankName: String, branch: String,
  },
  footerText: String,
  declaration: String,
  authorizedSignatoryName: String,
  authorizedSignatoryDesignation: String,
}, { _id: false });

const invoiceSchema = new Schema({
  invoiceNumber: { type: String, required: true },
  customerId: { type: ObjectId, ref: 'Customer', required: true },
  customerSnapshot: customerSnapshotSchema,
  supplierSnapshot: supplierSnapshotSchema,
  letterheadSnapshot: letterheadSnapshotSchema,
  invoiceDate: { type: Date, required: true },
  dueDate: Date,
  items: { type: [invoiceItemSchema], validate: (v) => v.length > 0 },
  subtotal: { type: Money, required: true },
  discount: { type: Money, default: 0 },
  taxableAmount: { type: Money, required: true },
  cgst: { type: Money, default: 0 },
  sgst: { type: Money, default: 0 },
  igst: { type: Money, default: 0 },
  cess: { type: Money, default: 0 },
  totalTax: { type: Money, default: 0 },
  roundOff: { type: Money, default: 0 },
  grandTotal: { type: Money, required: true },
  gstApplicable: { type: Boolean, required: true },
  interState: { type: Boolean, default: false },
  placeOfSupplyStateCode: String,
  notes: { type: String, maxlength: 2000 },
  termsAndConditions: { type: String, maxlength: 2000 },
  paymentStatus: { type: String, enum: enumOf(PAYMENT_STATUS), default: PAYMENT_STATUS.UNPAID },
  invoiceStatus: { type: String, enum: enumOf(INVOICE_STATUS), default: INVOICE_STATUS.DRAFT },
  tallySyncStatus: { type: String, enum: enumOf(TALLY_SYNC_STATUS), default: TALLY_SYNC_STATUS.NOT_SYNCED },
  gstFilingStatus: { type: String, enum: enumOf(GST_FILING_STATUS), default: GST_FILING_STATUS.PENDING },
  issuedBy: { type: ObjectId, ref: 'User' },
  issuedAt: Date,
  cancelledBy: { type: ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancellationReason: { type: String, maxlength: 500 },
}, { timestamps: true });
tenantPlugin(invoiceSchema); softDeletePlugin(invoiceSchema); actorPlugin(invoiceSchema);
invoiceSchema.index({ tenantId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ tenantId: 1, invoiceStatus: 1 });
invoiceSchema.index({ tenantId: 1, createdAt: -1 });
invoiceSchema.index({ tenantId: 1, customerId: 1 });
invoiceSchema.index({ tenantId: 1, invoiceDate: -1 });

/**
 * Phase 22 — Credit/Debit Notes. Always created directly against an already-ISSUED invoice (never a DRAFT
 * one) and is itself immutable from the moment it's created: no PATCH/update path exists, only a status
 * transition to CANCELLED (voided, never deleted — the same "never destroy financial history" rule as
 * Invoice.cancel). `customerSnapshot`/`supplierSnapshot` are copied straight from the parent invoice's own
 * frozen snapshots (never re-resolved from the live Customer/BusinessProfile), and `items`/totals are always
 * computed by the same InvoiceCalculationService the invoice itself uses — never client-supplied.
 */
const creditDebitNoteSchema = new Schema({
  noteNumber: { type: String, required: true },
  noteType: { type: String, enum: enumOf(NOTE_TYPE), required: true },
  invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
  invoiceNumber: { type: String, required: true },
  customerId: { type: ObjectId, ref: 'Customer', required: true },
  customerSnapshot: customerSnapshotSchema,
  supplierSnapshot: supplierSnapshotSchema,
  letterheadSnapshot: letterheadSnapshotSchema,
  noteDate: { type: Date, required: true },
  reason: { type: String, required: true, maxlength: 500 },
  items: { type: [invoiceItemSchema], validate: (v) => v.length > 0 },
  subtotal: { type: Money, required: true },
  discount: { type: Money, default: 0 },
  taxableAmount: { type: Money, required: true },
  cgst: { type: Money, default: 0 },
  sgst: { type: Money, default: 0 },
  igst: { type: Money, default: 0 },
  cess: { type: Money, default: 0 },
  totalTax: { type: Money, default: 0 },
  roundOff: { type: Money, default: 0 },
  grandTotal: { type: Money, required: true },
  gstApplicable: { type: Boolean, required: true },
  interState: { type: Boolean, default: false },
  status: { type: String, enum: enumOf(NOTE_STATUS), default: NOTE_STATUS.ISSUED },
  issuedBy: { type: ObjectId, ref: 'User' },
  cancelledBy: { type: ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancellationReason: { type: String, maxlength: 500 },
}, { timestamps: true });
tenantPlugin(creditDebitNoteSchema); softDeletePlugin(creditDebitNoteSchema); actorPlugin(creditDebitNoteSchema);
creditDebitNoteSchema.index({ tenantId: 1, noteNumber: 1 }, { unique: true });
creditDebitNoteSchema.index({ tenantId: 1, invoiceId: 1 });
creditDebitNoteSchema.index({ tenantId: 1, noteType: 1, createdAt: -1 });

const gstConfigSchema = new Schema({
  gstRegistered: { type: Boolean, default: false },
  gstin: { type: String, uppercase: true, match: GSTIN_REGEX },
  registrationType: { type: String, enum: ['REGULAR', 'COMPOSITION', 'UNREGISTERED'], default: 'UNREGISTERED' },
  stateCode: String,
  defaultGstApplicable: { type: Boolean, default: false },
  filingFrequency: { type: String, enum: ['MONTHLY', 'QUARTERLY'], default: 'MONTHLY' },
}, { timestamps: true });
tenantPlugin(gstConfigSchema, { unique: true }); actorPlugin(gstConfigSchema);

/**
 * Phase 6: tenant-scoped Tally connection config. `connectionType` LOCAL_TALLY/REMOTE_TALLY both resolve
 * to the same thing operationally — a network-accessible HTTP/XML endpoint the ERP server itself can
 * reach (`baseUrl`). The ERP server runs on its own host and CANNOT reach a literal "localhost" belonging
 * to a customer's browser/desktop; "LOCAL_TALLY" only documents that, from the customer's point of view,
 * Tally runs on a machine on their own LAN (see docs/tally-integration.md).
 *
 * `authPasswordEncrypted` uses the existing AES-256-GCM `EncryptionService` (security/encryption.js) and
 * is `select:false` so it is excluded from default projections/queries; `serialize()` in utils/serialize.js
 * also strips any field literally named `credentialsEncrypted`/`secret`/etc as defence in depth. The API
 * never returns the raw secret — callers get a derived `hasPassword: true/false` boolean instead.
 */
const tallyIntegrationSchema = new Schema({
  enabled: { type: Boolean, default: false },
  status: { type: String, enum: ['NOT_CONFIGURED', 'CONFIGURED', 'DISABLED'], default: 'NOT_CONFIGURED' },
  connectionType: { type: String, enum: ['LOCAL_TALLY', 'REMOTE_TALLY'], default: 'LOCAL_TALLY' },
  baseUrl: { type: String, maxlength: 2048 },
  companyName: { type: String, maxlength: 200 },
  companyGuid: String,
  defaultVoucherType: { type: String, default: 'Sales', maxlength: 60 },
  salesLedger: { type: String, maxlength: 200 },
  cgstLedger: { type: String, maxlength: 200 },
  sgstLedger: { type: String, maxlength: 200 },
  igstLedger: { type: String, maxlength: 200 },
  roundOffLedger: { type: String, maxlength: 200 },
  // Phase 17: optional discount ledger for invoice vouchers with a non-zero invoice-level discount. Never
  // fabricated — if unset, the discount amount is simply not posted as a separate ledger line (documented
  // fallback; see docs/integrations/tally-connector.md "Ledger mapping").
  discountLedger: { type: String, maxlength: 200 },
  timeoutMs: { type: Number, min: 1000, max: 60000, default: 10000 },
  retryPolicy: {
    maxAttempts: { type: Number, min: 1, max: 10, default: 3 },
  },
  authUsername: { type: String, maxlength: 200 },
  /** AES-256-GCM encrypted (EncryptionService). Never returned by the API; see schema doc comment above. */
  authPasswordEncrypted: { type: String, select: false },
  /** Legacy field retained for backward compatibility with the Phase-pre-6 placeholder; unused going forward. */
  credentialsEncrypted: { type: String, select: false },
  ledgerMappings: { type: Schema.Types.Mixed, default: {} },
  lastSyncAt: Date,
  lastConnectedAt: Date,
  lastConnectionStatus: { type: String, enum: ['NEVER_TESTED', 'SUCCESS', 'FAILED'], default: 'NEVER_TESTED' },
}, { timestamps: true });
tenantPlugin(tallyIntegrationSchema, { unique: true }); actorPlugin(tallyIntegrationSchema);
tallyIntegrationSchema.index({ tenantId: 1, enabled: 1 });

/**
 * One TallySync record per (tenantId, invoiceId) — the unique index below IS the idempotency key (a
 * tenant has exactly one TallyIntegration, so (tenantId, invoiceId) already uniquely identifies "this
 * invoice synced against this tenant's one configured integration"; `integrationId` is still stored so a
 * future multi-integration-per-tenant design would only need to widen the index, not restructure the
 * collection).
 */
const tallySyncLogSchema = new Schema({
  invoiceId: { type: ObjectId, ref: 'Invoice', required: true },
  integrationId: { type: ObjectId, ref: 'TallyIntegration' },
  operation: { type: String, enum: ['CREATE', 'UPDATE', 'CANCEL'], default: 'CREATE' },
  requestReference: { type: String },
  status: { type: String, enum: enumOf(TALLY_SYNC_STATUS), required: true },
  attempt: { type: Number, default: 1 },
  voucherId: String,
  voucherNumber: String,
  errorCode: String,
  errorMessage: { type: String, maxlength: 1000 },
  startedAt: { type: Date, default: Date.now },
  completedAt: Date,
}, { timestamps: true });
tenantPlugin(tallySyncLogSchema);
tallySyncLogSchema.index({ tenantId: 1, invoiceId: 1 }, { unique: true });
tallySyncLogSchema.index({ tenantId: 1, status: 1, startedAt: -1 });
// Phase 9: supports the reports/dashboards `$lookup` (Invoice._id -> TallySyncLog.invoiceId); the compound
// (tenantId, invoiceId) index above cannot serve a lookup keyed on invoiceId alone.
tallySyncLogSchema.index({ invoiceId: 1 });

/**
 * Phase 8 — ERP-INTERNAL GST FILING WORKFLOW TRACKER.
 *
 * SCOPE BOUNDARY (do not expand without a deliberate decision): this is a progress/issue tracker for the
 * vendor+client+admin team working an invoice-period's GST return. It is explicitly NOT a GST portal
 * integration — there is no GSTN API call, no OTP/DSC/e-sign, and no verified government acknowledgement
 * anywhere in this codebase. `submissionInfo` below only ever records what a human typed into a form; its
 * `source` is hard-pinned to 'MANUALLY_RECORDED' so no caller can ever claim integration-verified data.
 *
 * `periodKey` ("YYYY-MM") + `returnType` + `tenantId` are the natural key (unique index below) — re-filing
 * a corrected/revised return for the same period+type is an explicit FUTURE enhancement, not built here.
 *
 * `dueDate` is a user/admin-entered planning aid only — never a verified statutory deadline.
 */
const filingMilestoneSchema = new Schema({
  key: { type: String, required: true },
  label: { type: String, required: true },
  status: { type: String, enum: enumOf(FILING_MILESTONE_STATUS), default: FILING_MILESTONE_STATUS.PENDING },
  order: { type: Number, required: true },
  completedAt: Date,
  completedBy: { type: ObjectId, ref: 'User' },
}, { _id: false });

const filingHistoryEntrySchema = new Schema({
  previousStatus: { type: String, enum: enumOf(FILING_STATUS) },
  newStatus: { type: String, enum: enumOf(FILING_STATUS), required: true },
  actor: { type: ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
  note: { type: String, maxlength: 1000 },
}, { _id: false });

/** Vendor-entered only; never populated from any government/integration source (none exists). */
const filingSubmissionInfoSchema = new Schema({
  acknowledgementNumber: { type: String, maxlength: 100 },
  referenceNumber: { type: String, maxlength: 100 },
  submittedAt: Date,
  source: { type: String, enum: enumOf(FILING_SUBMISSION_SOURCE), default: FILING_SUBMISSION_SOURCE.MANUALLY_RECORDED },
  notes: { type: String, maxlength: 2000 },
}, { _id: false });

const gstFilingSchema = new Schema({
  vendorUserId: { type: ObjectId, ref: 'User', default: null },
  periodKey: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
  financialYear: String,
  year: Number,
  month: Number,
  periodLabel: String,
  returnType: { type: String, enum: enumOf(FILING_RETURN_TYPE), required: true },
  status: { type: String, enum: enumOf(FILING_STATUS), default: FILING_STATUS.NOT_STARTED },
  progressPercent: { type: Number, default: 0, min: 0, max: 100 },
  milestones: { type: [filingMilestoneSchema], default: [] },
  dueDate: Date,
  assignedAt: Date,
  startedAt: Date,
  submittedAt: Date,
  completedAt: Date,
  submissionInfo: { type: filingSubmissionInfoSchema, default: () => ({}) },
  history: { type: [filingHistoryEntrySchema], default: [] },
  notes: { type: String, maxlength: 2000 },
}, { timestamps: true });
tenantPlugin(gstFilingSchema); actorPlugin(gstFilingSchema);
gstFilingSchema.index({ tenantId: 1, periodKey: 1, returnType: 1 }, { unique: true });
gstFilingSchema.index({ tenantId: 1, status: 1 });
gstFilingSchema.index({ vendorUserId: 1, status: 1 });
gstFilingSchema.index({ dueDate: 1 });

/** Independent from filing status by design (Phase 8 step 6) — an issue never auto-mutates filing.status. */
const gstFilingIssueSchema = new Schema({
  filingId: { type: ObjectId, ref: 'GSTFiling', required: true },
  invoiceId: { type: ObjectId, ref: 'Invoice', default: null },
  type: { type: String, enum: enumOf(FILING_ISSUE_TYPE), required: true },
  severity: { type: String, enum: enumOf(FILING_ISSUE_SEVERITY), default: FILING_ISSUE_SEVERITY.MEDIUM },
  title: { type: String, required: true, maxlength: 200 },
  description: { type: String, maxlength: 2000 },
  status: { type: String, enum: enumOf(FILING_ISSUE_STATUS), default: FILING_ISSUE_STATUS.OPEN },
  raisedBy: { type: ObjectId, ref: 'User', required: true },
  assignedTo: { type: ObjectId, ref: 'User', default: null },
  resolution: { type: String, maxlength: 2000 },
  resolvedBy: { type: ObjectId, ref: 'User' },
  resolvedAt: Date,
}, { timestamps: true });
tenantPlugin(gstFilingIssueSchema); actorPlugin(gstFilingIssueSchema);
gstFilingIssueSchema.index({ tenantId: 1, filingId: 1 });
gstFilingIssueSchema.index({ filingId: 1, status: 1 });
gstFilingIssueSchema.index({ severity: 1, status: 1 });
gstFilingIssueSchema.index({ invoiceId: 1 });

/**
 * Phase 19 — GST Bill Builder. A simple internal GST sales bill tied 1:1 to a GSTFiling — deliberately NOT
 * the official Invoice model above (no Customer, no per-line tax split): just serial/productName/rate lines
 * with a single flat GST rate applied to the whole bill. `documentIds` reuses the Phase 5 FileMetadata +
 * StorageService architecture, exactly like BillIntake.documentIds below. The unique (tenantId, filingId)
 * index is what makes "create if none exists, else load/update the existing one" safe without a transaction.
 */
const gstBillItemSchema = new Schema({
  serialNo: { type: Number, required: true, min: 1 },
  productName: { type: String, required: true, trim: true, maxlength: 200 },
  rate: { type: Money, required: true },
}, { _id: false });

const gstBillSchema = new Schema({
  filingId: { type: ObjectId, ref: 'GSTFiling', required: true },
  items: { type: [gstBillItemSchema], default: [] },
  gstRate: { type: Number, default: 18, min: 0, max: 100 },
  subtotal: { type: Money, default: 0 },
  gstAmount: { type: Money, default: 0 },
  grandTotal: { type: Money, default: 0 },
  // Client's own uploaded bill document(s) — see Phase 19 doc comment above.
  documentIds: { type: [ObjectId], ref: 'FileMetadata', default: [] },
  // Phase 21 — the GST_VENDOR's final processed document for this same bill/filing. Deliberately a SEPARATE
  // array (never merged with documentIds above): the client's uploaded bill and the vendor's final document
  // are different documents with different authors/purposes (FileMetadata.purpose distinguishes them too:
  // 'GST_BILL_DOCUMENT' vs 'VENDOR_FINAL_DOCUMENT'). A vendor upload only ever appends here — it never
  // touches `items`/`subtotal`/`gstAmount`/`grandTotal`/`documentIds` above.
  finalDocumentIds: { type: [ObjectId], ref: 'FileMetadata', default: [] },
}, { timestamps: true });
tenantPlugin(gstBillSchema); actorPlugin(gstBillSchema);
gstBillSchema.index({ tenantId: 1, filingId: 1 }, { unique: true });

/**
 * Phase 20 — GST Bill <-> Tally bill-by-bill matching result. One document per (tenantId, filingId) — a
 * re-run REPLACES this same row in place (unique index below is what makes that upsert safe, same pattern
 * as TallyIntegration's one-per-tenant upsert), never growing a history of stale runs. The GSTBill itself
 * (above) is NEVER modified by matching — this is a read-only comparison result living in its own
 * collection, exactly the "GSTFiling -> Reconciliation -> Results[]" shape the product spec describes.
 *
 * `results[]` has one entry per GSTBill.items[] line (there is no separate per-bill sub-document in the
 * Phase 19 GSTBill model — each line IS "one client bill" for matching purposes, identified by its
 * serialNo/productName/rate; see gstBillMatching.service.js for why no stronger identifier exists today).
 */
const gstBillMatchResultSchema = new Schema({
  serialNo: { type: Number, required: true },
  productName: { type: String, required: true },
  rate: { type: Money, required: true },
  tallyVoucherNumber: { type: String, default: null },
  tallyAmount: { type: Money, default: null },
  status: { type: String, enum: enumOf(GST_BILL_MATCH_STATUS), required: true },
  reason: { type: String, maxlength: 300 },
}, { _id: false });

const gstBillMatchSchema = new Schema({
  filingId: { type: ObjectId, ref: 'GSTFiling', required: true },
  billId: { type: ObjectId, ref: 'GSTBill', required: true },
  totalClientBills: { type: Number, required: true },
  totalTallyBills: { type: Number, required: true },
  matchedCount: { type: Number, required: true },
  unmatchedCount: { type: Number, required: true },
  extraTallyCount: { type: Number, required: true },
  overallStatus: { type: String, enum: enumOf(GST_BILL_OVERALL_MATCH_STATUS), required: true },
  results: { type: [gstBillMatchResultSchema], default: [] },
  errorMessage: { type: String, maxlength: 500 },
  ranAt: { type: Date, default: Date.now },
}, { timestamps: true });
tenantPlugin(gstBillMatchSchema); actorPlugin(gstBillMatchSchema);
gstBillMatchSchema.index({ tenantId: 1, filingId: 1 }, { unique: true });

/**
 * Phase 13 — Tally Public API key (Tally/TDL -> ERP direction; opposite of TallyIntegration above, which
 * is ERP -> Tally). The raw key is NEVER stored: only a keyed-HMAC hash (see security/apiKey.js, same
 * non-reversible pattern as RefreshToken.tokenHash) plus a short, non-secret prefix for human identification
 * in list views. A database compromise alone cannot yield a usable key.
 */
const tallyApiKeySchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  keyPrefix: { type: String, required: true, maxlength: 20 },
  keyHash: { type: String, required: true, unique: true },
  status: { type: String, enum: enumOf(TALLY_API_KEY_STATUS), default: TALLY_API_KEY_STATUS.ACTIVE },
  scopes: { type: [String], enum: TALLY_API_SCOPES, default: [] },
  lastUsedAt: Date,
  expiresAt: Date,
  revokedAt: Date,
  revokedBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });
tenantPlugin(tallyApiKeySchema); actorPlugin(tallyApiKeySchema);
tallyApiKeySchema.index({ tenantId: 1, status: 1 });
tallyApiKeySchema.index({ tenantId: 1, createdAt: -1 });

/**
 * Phase 15 — CLIENT BILL INTAKE + TALLY QUEUE.
 *
 * A client-uploaded bill is explicitly NOT an official ERP Invoice (see docs/bill-intake-workflow.md and the
 * spec's Step 2): it has its own lifecycle (BILL_STATUS) and never silently becomes an Invoice row. Fields
 * the client hasn't provided yet are left undefined rather than defaulted to a fake value (spec Step 3) —
 * this is why billNumber/billDate/vendorName/amount etc. are all optional at the schema level; the ERP
 * (review/Tally-readiness) workflow is what decides whether a bill has "enough" data to proceed, not the
 * schema. `documentIds` points at FileMetadata rows (Phase 5 storage architecture reused, not duplicated).
 */
const billHistoryEntrySchema = new Schema({
  previousStatus: { type: String, enum: enumOf(BILL_STATUS) },
  newStatus: { type: String, enum: enumOf(BILL_STATUS), required: true },
  actor: { type: ObjectId, ref: 'User', required: true },
  timestamp: { type: Date, default: Date.now },
  note: { type: String, maxlength: 1000 },
}, { _id: false });

const billIntakeSchema = new Schema({
  clientUserId: { type: ObjectId, ref: 'User', required: true },
  billNumber: { type: String, trim: true, maxlength: 100 },
  billDate: Date,
  vendorName: { type: String, trim: true, maxlength: 200 },
  vendorGSTIN: { type: String, uppercase: true, match: GSTIN_REGEX },
  amount: { type: Money },
  taxableAmount: { type: Money },
  cgst: { type: Money },
  sgst: { type: Money },
  igst: { type: Money },
  notes: { type: String, maxlength: 2000 },
  documentIds: { type: [ObjectId], ref: 'FileMetadata', default: [] },
  status: { type: String, enum: enumOf(BILL_STATUS), default: BILL_STATUS.DRAFT },
  tallyStatus: { type: String, enum: enumOf(BILL_TALLY_STATUS), default: BILL_TALLY_STATUS.NOT_READY },
  submittedAt: Date,
  submittedBy: { type: ObjectId, ref: 'User' },
  reviewedAt: Date,
  reviewedBy: { type: ObjectId, ref: 'User' },
  rejectionReason: { type: String, maxlength: 1000 },
  readyForTallyAt: Date,
  /** Reasons a bill failed ERP-level Tally-readiness (spec Step 13) — never fabricated, always derived from missing fields. */
  tallyReadinessIssues: { type: [String], default: [] },
  queuedAt: Date,
  lastSyncAttemptAt: Date,
  tallyReference: { type: String, maxlength: 200 },
  tallySyncLogId: { type: ObjectId, ref: 'TallySyncLog' },
  tallyFailureReason: { type: String, maxlength: 1000 },
  completedAt: Date,
  history: { type: [billHistoryEntrySchema], default: [] },
}, { timestamps: true });
tenantPlugin(billIntakeSchema); actorPlugin(billIntakeSchema);
billIntakeSchema.index({ tenantId: 1, status: 1 });
billIntakeSchema.index({ tenantId: 1, tallyStatus: 1 });
billIntakeSchema.index({ tenantId: 1, createdAt: -1 });
billIntakeSchema.index({ tenantId: 1, billNumber: 1 });

/**
 * Phase 16 — TALLY CONNECTOR BRIDGE (Side A: cloud ERP's view of a registered Windows connector).
 *
 * Deliberately does NOT store Windows username, machine serial number, personal files or browser info
 * (spec Step 4) — only what the admin UI / troubleshooting flow genuinely needs. The raw connector secret
 * is NEVER stored: only `secretHash` (same keyed-HMAC, non-reversible pattern as TallyApiKey.keyHash /
 * RefreshToken.tokenHash — see security/apiKey.js#hashApiKey, reused as-is). `secretPrefix` is non-secret,
 * for human identification in list views only (same pattern as TallyApiKey.keyPrefix).
 */
const tallyConnectorSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  secretPrefix: { type: String, required: true, maxlength: 24 },
  secretHash: { type: String, required: true, unique: true },
  status: { type: String, enum: enumOf(TALLY_CONNECTOR_STATUS), default: TALLY_CONNECTOR_STATUS.ACTIVE },
  scopes: { type: [String], enum: TALLY_CONNECTOR_SCOPES, default: [...TALLY_CONNECTOR_SCOPES] },
  version: { type: String, maxlength: 40 },
  lastHeartbeatAt: Date,
  lastPollAt: Date,
  lastSuccessfulSyncAt: Date,
  lastErrorCode: { type: String, maxlength: 60 },
  lastErrorMessage: { type: String, maxlength: 1000 },
  lastTallyAvailable: { type: Boolean, default: null },
  // Mirrors (never redefines) the tenant's single TallyIntegration.companyName/companyGuid — set at
  // registration time so the connector's claimed company identity can be verified against it before every
  // job dispatch (spec Step 15: "fail safely if company mapping can't be verified").
  tallyCompanyName: { type: String, maxlength: 200 },
  tallyCompanyGuid: { type: String, maxlength: 200 },
  revokedAt: Date,
  revokedBy: { type: ObjectId, ref: 'User' },
  // Phase 16.1: set by the offline monitor when it flips an ACTIVE connector to INACTIVE for a stale
  // heartbeat (never by manual deactivation); cleared on recovery. Lets the monitor tell "went offline
  // on its own" apart from "an admin deliberately deactivated this", so a heartbeat only auto-recovers the former.
  offlineSince: { type: Date, default: null },
}, { timestamps: true });
tenantPlugin(tallyConnectorSchema); actorPlugin(tallyConnectorSchema);
tallyConnectorSchema.index({ tenantId: 1, status: 1 });

/**
 * Phase 16 — TALLY JOB (work-queue row bridging a READY_FOR_TALLY BillIntake to a connector). The unique
 * index below (tenantId+billIntakeId+type) IS the idempotency key (spec Step 10/19): a second attempt to
 * create a job for the same bill+type is a duplicate-key no-op at the database level, never a second row.
 * `availableAt` is what makes a FAILED job retryable without a separate "scheduled" collection — the
 * claim query is simply `status in (QUEUED) and availableAt <= now` (see TallyJobRepository#claimNext).
 */
const tallyJobSchema = new Schema({
  billIntakeId: { type: ObjectId, ref: 'BillIntake', required: true },
  invoiceId: { type: ObjectId, ref: 'Invoice', default: null },
  connectorId: { type: ObjectId, ref: 'TallyConnector', default: null },
  type: { type: String, enum: enumOf(TALLY_JOB_TYPE), required: true },
  status: { type: String, enum: enumOf(TALLY_JOB_STATUS), default: TALLY_JOB_STATUS.QUEUED },
  attempts: { type: Number, default: 0 },
  availableAt: { type: Date, default: Date.now },
  claimedAt: Date,
  startedAt: Date,
  completedAt: Date,
  failedAt: Date,
  lastErrorCode: { type: String, maxlength: 60 },
  lastErrorMessage: { type: String, maxlength: 1000 },
  tallyReference: { type: String, maxlength: 200 },
  requestId: { type: String, maxlength: 80 },
  // Deterministic, server-derived (tenantId+billIntakeId+type) — never client-supplied — see
  // tallyJob.service.js#create. Kept as its own field (rather than relying solely on the unique index) so
  // result-reporting/claim handlers can log/compare it without re-deriving it.
  idempotencyKey: { type: String, required: true, maxlength: 200 },
}, { timestamps: true });
tenantPlugin(tallyJobSchema); actorPlugin(tallyJobSchema);
tallyJobSchema.index({ tenantId: 1, billIntakeId: 1, type: 1 }, { unique: true });
tallyJobSchema.index({ tenantId: 1, status: 1, availableAt: 1 });
tallyJobSchema.index({ connectorId: 1, status: 1 });

export const businessModels = {
  Product: model('Product', productSchema),
  Customer: model('Customer', customerSchema),
  Invoice: model('Invoice', invoiceSchema),
  CreditDebitNote: model('CreditDebitNote', creditDebitNoteSchema),
  GSTConfiguration: model('GSTConfiguration', gstConfigSchema),
  TallyIntegration: model('TallyIntegration', tallyIntegrationSchema),
  TallySyncLog: model('TallySyncLog', tallySyncLogSchema),
  GSTFiling: model('GSTFiling', gstFilingSchema),
  GSTFilingIssue: model('GSTFilingIssue', gstFilingIssueSchema),
  GSTBill: model('GSTBill', gstBillSchema),
  GSTBillMatch: model('GSTBillMatch', gstBillMatchSchema),
  TallyApiKey: model('TallyApiKey', tallyApiKeySchema),
  BillIntake: model('BillIntake', billIntakeSchema),
  TallyConnector: model('TallyConnector', tallyConnectorSchema),
  TallyJob: model('TallyJob', tallyJobSchema),
};
