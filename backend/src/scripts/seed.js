/* eslint-disable no-console */
import { env } from '../config/env.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { models } from '../models/index.js';
import { buildContainer } from '../container.js';
import { hashPassword } from '../security/password.js';
import { ALL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS } from '../constants/permissions.js';
import { ROLES } from '../constants/roles.js';

/**
 * DEVELOPMENT SEED ONLY. All identities and credentials below are fake and publicly documented.
 * The script refuses to run when NODE_ENV=production.
 */
if (env.isProd) { console.error('Refusing to seed a production environment.'); process.exit(1); }

export const DEV_PASSWORD = 'DevOnly-ChangeMe-123';
export const SEED_USERS = Object.freeze({
  master: 'master.admin@example.test',
  clientAdmin: 'client.admin@example.test',
  clientUser: 'client.user@example.test',
  clientBAdmin: 'clientb.admin@example.test',
  clientBUser: 'clientb.user@example.test',
  vendor: 'gst.vendor@example.test',
  vendorB: 'gst.vendorb@example.test',
});

await connectDatabase();
const { repos, services } = buildContainer(models);
const passwordHash = await hashPassword(DEV_PASSWORD);

await models.Permission.deleteMany({ key: { $nin: ALL_PERMISSIONS } });
for (const key of ALL_PERMISSIONS) {
  await models.Permission.updateOne({ key }, { $setOnInsert: { key, module: key.split('.')[0], description: key } }, { upsert: true });
}
for (const [name, permissions] of Object.entries(ROLE_DEFAULT_PERMISSIONS)) {
  await models.Role.updateOne({ tenantId: null, name }, { $set: { permissions, isSystem: true, description: `System role ${name}` } }, { upsert: true });
}

const ensureUser = async (email, data) => (await repos.users.findByEmail(email)) ?? repos.users.createUnscoped({
  email, passwordHash, status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0, isEmailVerified: true, passwordChangedAt: new Date(), ...data,
});

const master = await ensureUser(SEED_USERS.master, { name: 'Demo Master Admin', role: ROLES.MASTER_ADMIN });

let tenant = await repos.tenants.findByCode('TNT-DEMO01');
if (!tenant) {
  tenant = await repos.tenants.create({ tenantCode: 'TNT-DEMO01', businessName: 'Demo Traders (FAKE DATA)', legalName: 'Demo Traders Private Limited', email: 'accounts@demo-traders.example.test', status: 'ACTIVE', createdBy: master._id });
}
const clientAdmin = await ensureUser(SEED_USERS.clientAdmin, { name: 'Demo Client Admin', role: ROLES.CLIENT_ADMIN, tenantId: tenant._id });
await ensureUser(SEED_USERS.clientUser, { name: 'Demo Client User', role: ROLES.CLIENT_USER, tenantId: tenant._id });

// Client B: demonstrates multi-tenant isolation and multi-vendor assignment (Vendor A is assigned to both
// Client A and Client B; Vendor B is assigned to Client B only).
let tenantB = await repos.tenants.findByCode('TNT-DEMO02');
if (!tenantB) {
  tenantB = await repos.tenants.create({ tenantCode: 'TNT-DEMO02', businessName: 'Demo Logistics Co (FAKE DATA)', legalName: 'Demo Logistics Private Limited', email: 'accounts@demo-logistics.example.test', status: 'ACTIVE', createdBy: master._id });
}
await ensureUser(SEED_USERS.clientBAdmin, { name: 'Demo Client B Admin', role: ROLES.CLIENT_ADMIN, tenantId: tenantB._id });
await ensureUser(SEED_USERS.clientBUser, { name: 'Demo Client B User', role: ROLES.CLIENT_USER, tenantId: tenantB._id });

const ensureVendor = async (code, data) => (await models.Vendor.findOne({ vendorCode: code }).lean())
  ?? repos.vendors.create({ vendorCode: code, status: 'ACTIVE', createdBy: master._id, ...data });

const vendor = await ensureVendor('VEND-DEMO01', { name: 'Demo GST Filing Partner (FAKE)', contactEmail: 'vendor@demo-gst.example.test' });
await ensureUser(SEED_USERS.vendor, { name: 'Demo GST Vendor', role: ROLES.GST_VENDOR, vendorId: vendor._id });
const vendorB = await ensureVendor('VEND-DEMO02', { name: 'Demo GST Filing Partner II (FAKE)', contactEmail: 'vendorb@demo-gst.example.test' });
await ensureUser(SEED_USERS.vendorB, { name: 'Demo GST Vendor B', role: ROLES.GST_VENDOR, vendorId: vendorB._id });

// Vendor A -> Client A (ACTIVE), Vendor A -> Client B (ACTIVE): demonstrates one vendor serving multiple clients.
if (!(await repos.assignments.findActive(vendor._id, tenant._id))) {
  await repos.assignments.create({ vendorId: vendor._id, tenantId: tenant._id, assignedBy: master._id, status: 'ACTIVE', assignedAt: new Date() });
}
if (!(await repos.assignments.findActive(vendor._id, tenantB._id))) {
  await repos.assignments.create({ vendorId: vendor._id, tenantId: tenantB._id, assignedBy: master._id, status: 'ACTIVE', assignedAt: new Date() });
}
// Vendor B -> Client B only (ACTIVE): demonstrates multiple vendors serving the same client.
if (!(await repos.assignments.findActive(vendorB._id, tenantB._id))) {
  await repos.assignments.create({ vendorId: vendorB._id, tenantId: tenantB._id, assignedBy: master._id, status: 'ACTIVE', assignedAt: new Date() });
}
// Historical lifecycle demo: Vendor B was previously assigned to Client A, then deactivated (never hard-deleted).
const existingHistorical = await models.VendorClientAssignment.findOne({ vendorId: vendorB._id, tenantId: tenant._id }).lean();
if (!existingHistorical) {
  await repos.assignments.create({
    vendorId: vendorB._id, tenantId: tenant._id, assignedBy: master._id, status: 'INACTIVE',
    assignedAt: new Date('2026-01-01'), unassignedAt: new Date('2026-02-01'), unassignedBy: master._id,
    deactivationReason: 'Demo: engagement with Client A ended (historical record, never hard-deleted)',
  });
}

const ctx = { tenantId: String(tenant._id), actor: { id: String(clientAdmin._id), role: ROLES.CLIENT_ADMIN }, permissions: new Set(), ip: '127.0.0.1', requestId: 'seed' };
if ((await repos.products.count(tenant._id)) === 0) {
  await services.productService.create(ctx, { productName: 'Demo Widget', sellingPrice: '1000.00', gstRate: 18, isGstApplicable: true, unit: 'NOS', hsnSacCode: '8471' });
  await services.productService.create(ctx, { productName: 'Demo Consulting Hour', type: 'SERVICE', sellingPrice: '2500.00', gstRate: 18, isGstApplicable: true, unit: 'SERVICE', hsnSacCode: '998313' });
  await services.productService.create(ctx, { productName: 'Demo Packaging Box', sellingPrice: '45.00', gstRate: 12, isGstApplicable: true, unit: 'PCS', hsnSacCode: '4819' });
}
if ((await repos.customers.count(tenant._id)) === 0) {
  await services.customerService.create(ctx, { name: 'Demo Customer (FAKE)', email: 'customer@example.test' });
  await services.customerService.create(ctx, { name: 'Demo Retail Buyer (FAKE)', businessName: 'Demo Retail Co', email: 'retail@example.test', gstin: '27AAAPL1234C1Z5' });
}
if (!(await repos.businessProfiles.findByTenant(tenant._id))) {
  await services.businessProfileService.create(ctx, {
    displayName: 'Demo Traders (FAKE DATA)', mobile: '9876500001', email: 'profile@demo-traders.example.test',
    address: { line1: '1 MG Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001' },
  });
}

// Demo Tally config for tenant A only: enabled but pointing at a placeholder `.test` host (RFC 2606
// reserved, guaranteed never to resolve), so seeding never attempts a real network call. CLIENT_ADMIN
// can use "Test Connection" in the UI to see the normalized unreachable-endpoint error first-hand.
if (!(await repos.tallyIntegrations.findByTenant(tenant._id))) {
  await repos.tallyIntegrations.upsert(tenant._id, {
    enabled: true, connectionType: 'LOCAL_TALLY', baseUrl: 'http://tally.invalid.example.test:9000',
    companyName: 'Demo Traders (FAKE DATA)', defaultVoucherType: 'Sales',
    salesLedger: 'Sales Account', cgstLedger: 'CGST Output', sgstLedger: 'SGST Output', igstLedger: 'IGST Output', roundOffLedger: 'Round Off',
    timeoutMs: 10000, retryPolicy: { maxAttempts: 3 }, status: 'CONFIGURED',
  }, clientAdmin._id);
}

const seedInvoices = async (tenantRecord, ctxFor) => {
  if ((await repos.invoices.count(tenantRecord._id)) > 0) return;
  const products = await repos.products.findPage(tenantRecord._id, { limit: 10 });
  const customers = await repos.customers.findPage(tenantRecord._id, { limit: 10 });
  if (!products.items.length || !customers.items.length) return;
  const mk = (qty) => ({
    customerId: String(customers.items[0]._id), invoiceDate: new Date('2026-04-01'), gstApplicable: true,
    items: [{ productId: String(products.items[0]._id), quantity: qty }],
  });
  // One DRAFT (still editable) and one ISSUED (authoritative, immutable, demonstrates the full lifecycle).
  await services.invoiceService.create(ctxFor, mk('1'));
  const toIssue = await services.invoiceService.create(ctxFor, mk('2'));
  await services.invoiceService.issue(ctxFor, toIssue._id);
};
await seedInvoices(tenant, ctx);

const ctxB = { tenantId: String(tenantB._id), actor: { id: String((await repos.users.findByEmail(SEED_USERS.clientBAdmin))._id), role: ROLES.CLIENT_ADMIN }, permissions: new Set(), ip: '127.0.0.1', requestId: 'seed' };
if ((await repos.products.count(tenantB._id)) === 0) {
  await services.productService.create(ctxB, { productName: 'Demo Freight Service', type: 'SERVICE', sellingPrice: '5000.00', gstRate: 18, isGstApplicable: true, unit: 'SERVICE', hsnSacCode: '996511' });
  await services.productService.create(ctxB, { productName: 'Demo Pallet', sellingPrice: '300.00', gstRate: 18, isGstApplicable: true, unit: 'PCS', hsnSacCode: '4415' });
}
if ((await repos.customers.count(tenantB._id)) === 0) {
  await services.customerService.create(ctxB, { name: 'Demo Logistics Customer (FAKE)', email: 'customer@demo-logistics.example.test' });
}
if (!(await repos.businessProfiles.findByTenant(tenantB._id))) {
  await services.businessProfileService.create(ctxB, {
    displayName: 'Demo Logistics Co (FAKE DATA)', mobile: '9876500002', email: 'profile@demo-logistics.example.test',
    address: { line1: '22 Industrial Area', city: 'Nagpur', state: 'Maharashtra', stateCode: '27', pincode: '440001' },
  });
}
await seedInvoices(tenantB, ctxB);

// ---- Phase 8: GST filing workflow tracker demo data -----------------------------------------
// ERP-internal workflow tracker only. No government acknowledgement/ARN is ever fabricated here:
// the one FILED demo filing below uses an obviously-synthetic "DEMO-REF-..." value, explicitly
// labelled source: 'MANUALLY_RECORDED' — never presented as integration-verified.
const vendorUser = await repos.users.findByEmail(SEED_USERS.vendor);
const vendorBUser = await repos.users.findByEmail(SEED_USERS.vendorB);

const ensureFiling = async (tenantRecord, periodKey, returnType, data) => {
  const existing = await repos.gstFilings.findOne(tenantRecord._id, { periodKey, returnType });
  if (existing) return existing;
  return repos.gstFilings.create(tenantRecord._id, { periodKey, returnType, ...data }, master._id);
};

// Client A: GSTR_1 for 2026-04, assigned to Vendor A, IN_PROGRESS with one resolved + one open issue.
const [yA, mA] = ['2026', '04'];
const filingA = await ensureFiling(tenant, '2026-04', 'GSTR_1', {
  vendorUserId: vendorUser._id, year: Number(yA), month: Number(mA), financialYear: '2025-26', periodLabel: '2026-04 (GSTR_1)',
  status: 'IN_PROGRESS', progressPercent: 40, assignedAt: new Date('2026-04-02'), startedAt: new Date('2026-04-03'),
  milestones: [
    { key: 'DATA_COLLECTION', label: 'Collect & verify invoice data', status: 'DONE', order: 1, completedAt: new Date('2026-04-03'), completedBy: clientAdmin._id },
    { key: 'RECONCILIATION', label: 'Reconcile against Tally sync records', status: 'DONE', order: 2, completedAt: new Date('2026-04-04'), completedBy: vendorUser._id },
    { key: 'ISSUE_RESOLUTION', label: 'Resolve open issues', status: 'IN_PROGRESS', order: 3 },
    { key: 'REVIEW', label: 'Internal review complete', status: 'PENDING', order: 4 },
    { key: 'SUBMISSION', label: 'Return submitted', status: 'PENDING', order: 5 },
  ],
  history: [{ previousStatus: 'NOT_STARTED', newStatus: 'IN_PROGRESS', actor: vendorUser._id, timestamp: new Date('2026-04-03'), note: 'Demo seed: work started' }],
  notes: 'Demo seed filing (FAKE DATA).',
});
if ((await repos.gstFilingIssues.count(tenant._id, { filingId: String(filingA._id) })) === 0) {
  await repos.gstFilingIssues.create(tenant._id, {
    filingId: String(filingA._id), type: 'CUSTOMER_DATA', severity: 'LOW', title: 'Demo: customer PAN missing on one record (FAKE)',
    description: 'Seed demo issue, already resolved.', status: 'RESOLVED', raisedBy: vendorUser._id, resolvedBy: vendorUser._id, resolvedAt: new Date('2026-04-05'),
    resolution: 'Demo: PAN added to customer record.',
  });
  await repos.gstFilingIssues.create(tenant._id, {
    filingId: String(filingA._id), type: 'TALLY_SYNC', severity: 'MEDIUM', title: 'Demo: one invoice not yet Tally-synced (FAKE)',
    description: 'Seed demo issue, still open.', status: 'OPEN', raisedBy: vendorUser._id,
  });
}

// Client B: GSTR_3B for 2026-05, assigned to Vendor B, taken all the way to FILED with an obviously-synthetic
// manually-recorded reference — demonstrating the full lifecycle without ever faking a real ARN.
const filingB = await ensureFiling(tenantB, '2026-05', 'GSTR_3B', {
  vendorUserId: vendorBUser._id, year: 2026, month: 5, financialYear: '2025-26', periodLabel: '2026-05 (GSTR_3B)',
  status: 'FILED', progressPercent: 100,
  assignedAt: new Date('2026-05-01'), startedAt: new Date('2026-05-02'), submittedAt: new Date('2026-05-10'), completedAt: new Date('2026-05-11'),
  milestones: [
    { key: 'DATA_COLLECTION', label: 'Collect & verify invoice data', status: 'DONE', order: 1, completedAt: new Date('2026-05-02'), completedBy: vendorBUser._id },
    { key: 'RECONCILIATION', label: 'Reconcile against Tally sync records', status: 'DONE', order: 2, completedAt: new Date('2026-05-03'), completedBy: vendorBUser._id },
    { key: 'ISSUE_RESOLUTION', label: 'Resolve open issues', status: 'DONE', order: 3, completedAt: new Date('2026-05-04'), completedBy: vendorBUser._id },
    { key: 'REVIEW', label: 'Internal review complete', status: 'DONE', order: 4, completedAt: new Date('2026-05-09'), completedBy: vendorBUser._id },
    { key: 'SUBMISSION', label: 'Return submitted', status: 'DONE', order: 5, completedAt: new Date('2026-05-10'), completedBy: vendorBUser._id },
  ],
  submissionInfo: {
    acknowledgementNumber: 'DEMO-REF-0001', referenceNumber: 'DEMO-REF-0001', submittedAt: new Date('2026-05-10'),
    source: 'MANUALLY_RECORDED', notes: 'Demo seed: manually typed in by the vendor after filing outside this system. Not verified by any integration.',
  },
  history: [
    { previousStatus: 'NOT_STARTED', newStatus: 'IN_PROGRESS', actor: vendorBUser._id, timestamp: new Date('2026-05-02'), note: 'Demo seed' },
    { previousStatus: 'IN_PROGRESS', newStatus: 'READY_FOR_REVIEW', actor: vendorBUser._id, timestamp: new Date('2026-05-09'), note: 'Demo seed' },
    { previousStatus: 'READY_FOR_REVIEW', newStatus: 'SUBMITTED', actor: vendorBUser._id, timestamp: new Date('2026-05-10'), note: 'Demo seed' },
    { previousStatus: 'SUBMITTED', newStatus: 'FILED', actor: vendorBUser._id, timestamp: new Date('2026-05-11'), note: 'Demo seed' },
  ],
  notes: 'Demo seed filing (FAKE DATA) — fully filed, manually-recorded submission info only.',
});
// ---- Phase 9: notification demo data ---------------------------------------------------------
// Rebuild ONLY the Notification collection's indexes: the Phase 1 placeholder schema had a different
// (never-written) index set, and the per-recipient dedup unique index must exist before any write.
await models.Notification.syncIndexes();
// Generated through the real NotificationService event hooks from already-seeded (FAKE-labelled) entities,
// so recipients/action URLs follow the production rules. Idempotent: each hook's dedup key makes a re-run a no-op.
const { notificationService } = services;
const seededIssued = (await repos.invoices.findPage(tenant._id, { filter: { invoiceStatus: 'ISSUED' }, limit: 1 })).items[0];
if (seededIssued) await notificationService.invoiceIssued(seededIssued);
const openSeedIssue = await repos.gstFilingIssues.findOne(tenant._id, { filingId: String(filingA._id), status: 'OPEN' });
if (openSeedIssue) await notificationService.filingIssueOpened(filingA, openSeedIssue);
await notificationService.filingTransitioned(filingB, 'markFiled');
console.log(`Notifications in database: ${await models.Notification.countDocuments()}`);

console.log('\nDevelopment seed complete. FAKE, DEVELOPMENT-ONLY credentials:');
console.log(`  password for every account: ${DEV_PASSWORD}`);
Object.values(SEED_USERS).forEach((e) => console.log(`  - ${e}`));
await disconnectDatabase();