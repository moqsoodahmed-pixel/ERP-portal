import './env.js';
import request from 'supertest';
import { FakeModel } from './fakeModel.js';

const UNIQUE = {
  User: [['email']], Tenant: [['tenantCode']], Product: [['tenantId', 'productCode']], Customer: [['tenantId', 'customerCode']],
  Invoice: [['tenantId', 'invoiceNumber']], Counter: [['tenantId', 'name']], IdempotencyKey: [['tenantId', 'scope', 'key']],
  BusinessProfile: [['tenantId']],
  Document: [['tenantId', 'entityType', 'entityId', 'documentType']],
  TallyIntegration: [['tenantId']],
  TallySyncLog: [['tenantId', 'invoiceId']],
  RefreshToken: [['tokenHash']], Vendor: [['vendorCode']],
  TallyApiKey: [['keyHash']],
  // Phase 16: connector secret hash is globally unique; a job is unique per (tenant, bill, type) — this IS the idempotency guarantee (spec Step 10/19).
  TallyConnector: [['secretHash']],
  TallyJob: [['tenantId', 'billIntakeId', 'type']],
  GSTFiling: [['tenantId', 'periodKey', 'returnType']],
  // Phase 9: per-recipient notification dedup key (mirrors the unique index on the Notification schema).
  Notification: [['recipientUserId', 'dedupKey']],
  // Phase 15: bill-document storage keys are unique per tenant (mirrors the FileMetadata schema index).
  FileMetadata: [['tenantId', 'storageKey']],
};

export const PASSWORD = 'Dev-Only-Pass-123';

export async function createHarness({ rateLimits } = {}) {
  const { models } = await import('../../src/models/index.js');
  const { buildContainer } = await import('../../src/container.js');
  const { createApp } = await import('../../src/app.js');
  const { hashPassword } = await import('../../src/security/password.js');

  const fake = Object.fromEntries(Object.keys(models).map((n) => [n, new FakeModel(n, { unique: UNIQUE[n] ?? [] })]));
  FakeModel.registry = fake;
  const container = buildContainer(fake);
  const app = createApp(container, { rateLimits });
  const { repos, services } = container;
  const passwordHash = await hashPassword(PASSWORD);

  const mkTenant = async (name, { withInvoice = true } = {}) => {
    const t = await repos.tenants.create({ tenantCode: `T-${name}`, businessName: `Business ${name}`, status: 'ACTIVE' });
    const mkUser = (suffix, role, extra = {}) => repos.users.createUnscoped({
      tenantId: t._id, name: `${name} ${suffix}`, email: `${suffix}.${name.toLowerCase()}@example.test`, passwordHash, role,
      status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0, ...extra,
    });
    const admin = await mkUser('admin', 'CLIENT_ADMIN');
    const staff = await mkUser('staff', 'CLIENT_USER');
    const ctx = { tenantId: String(t._id), actor: { id: String(admin._id), role: 'CLIENT_ADMIN' }, permissions: new Set(['products.create']), ip: '127.0.0.1', requestId: 'seed' };
    if (!withInvoice) return { tenant: t, admin, staff, ctx };
    const businessProfile = await services.businessProfileService.create(ctx, {
      displayName: `${name} Business`, gstin: `${name === 'A' ? '27' : '29'}AAAAA0000A1Z5`, address: { state: 'Demo State', stateCode: name === 'A' ? '27' : '29' },
    });
    const product = await services.productService.create(ctx, { productName: `${name} Widget`, sellingPrice: '100.00', gstRate: 18, isGstApplicable: true, unit: 'NOS' });
    const customer = await services.customerService.create(ctx, { name: `${name} Customer`, billingAddress: { state: 'Demo State', stateCode: name === 'A' ? '27' : '29' } });
    const invoice = await services.invoiceService.create(ctx, {
      customerId: String(customer._id), invoiceDate: new Date('2026-04-01'), gstApplicable: true, items: [{ productId: String(product._id), quantity: '2' }],
    });
    return { tenant: t, admin, staff, businessProfile, product, customer, invoice, ctx };
  };

  const A = await mkTenant('A');
  const B = await mkTenant('B');
  const master = await repos.users.createUnscoped({ name: 'Master', email: 'master@example.test', passwordHash, role: 'MASTER_ADMIN', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0 });
  const { formatCode } = await import('../../src/utils/codes.js');
  const { ID_PREFIX } = await import('../../src/constants/pagination.js');
  const vendorCode = formatCode(ID_PREFIX.vendor, await repos.counters.next(null, 'vendor'));
  const vendor = await repos.vendors.create({ vendorCode, name: 'Vendor A', status: 'ACTIVE' });
  const vendorUser = await repos.users.createUnscoped({ vendorId: vendor._id, name: 'Vendor User', email: 'vendor@example.test', passwordHash, role: 'GST_VENDOR', status: 'ACTIVE', tokenVersion: 0, failedLoginAttempts: 0 });
  await repos.assignments.create({ vendorId: vendor._id, tenantId: A.tenant._id, assignedBy: master._id, status: 'ACTIVE', assignedAt: new Date() });

  const api = request(app);
  const login = async (email, password = PASSWORD) => {
    const res = await api.post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    return { token: res.body.data.accessToken, cookie: res.headers['set-cookie'], res };
  };
  const bearer = (t) => ({ Authorization: `Bearer ${t}` });

  return { app, api, fake, container, repos, services, A, B, master, vendor, vendorUser, login, bearer, mkTenant };
}
