import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { models } from '../../src/models/index.js';
import { ALL_PERMISSIONS, GRANTABLE_TO_TENANT_USERS, ROLE_DEFAULT_PERMISSIONS } from '../../src/constants/permissions.js';
import { PermissionService } from '../../src/services/permission.service.js';

const REQUIRED = ['User', 'Role', 'Permission', 'UserRole', 'Tenant', 'BusinessProfile', 'Vendor', 'VendorClientAssignment', 'Product', 'Customer', 'Invoice', 'GSTConfiguration', 'TallyIntegration', 'TallySyncLog', 'GSTFiling', 'GSTFilingIssue', 'AuditLog', 'RefreshToken', 'ConsentRecord', 'DataRequest', 'SecurityEvent', 'Notification', 'FileMetadata', 'PrivacyNotice', 'PrivacyNoticeVersion', 'Document'];
const hasIndex = (model, spec, unique) => model.schema.indexes().some(([k, o]) => JSON.stringify(k) === JSON.stringify(spec) && (!unique || o.unique));

test('all required models are registered', () => { for (const n of REQUIRED) assert.ok(models[n], n); });
test('every tenant-owned model has a required tenantId', () => {
  for (const n of ['BusinessProfile', 'Product', 'Customer', 'Invoice', 'GSTConfiguration', 'TallyIntegration', 'TallySyncLog', 'GSTFiling', 'GSTFilingIssue', 'ConsentRecord', 'DataRequest', 'Notification', 'FileMetadata', 'Document']) {
    assert.equal(models[n].schema.path('tenantId').isRequired, true, n);
  }
});
test('required unique/compound indexes exist', () => {
  assert.ok(hasIndex(models.Product, { tenantId: 1, productCode: 1 }, true));
  assert.ok(hasIndex(models.Customer, { tenantId: 1, customerCode: 1 }, true));
  assert.ok(hasIndex(models.Invoice, { tenantId: 1, invoiceNumber: 1 }, true));
  assert.ok(hasIndex(models.Invoice, { tenantId: 1, invoiceStatus: 1 }));
  assert.ok(hasIndex(models.Invoice, { tenantId: 1, createdAt: -1 }));
  assert.ok(hasIndex(models.User, { email: 1 }, true));
  assert.ok(hasIndex(models.VendorClientAssignment, { vendorId: 1, tenantId: 1 }, true));
  assert.ok(hasIndex(models.Document, { tenantId: 1, entityType: 1, entityId: 1, documentType: 1 }, true));
  assert.ok(hasIndex(models.GSTFiling, { tenantId: 1, periodKey: 1, returnType: 1 }, true));
  assert.ok(hasIndex(models.GSTFilingIssue, { filingId: 1, status: 1 }));
});
test('sensitive schema paths are not selected by default', () => {
  assert.equal(models.User.schema.path('passwordHash').options.select, false);
  assert.equal(models.TallyIntegration.schema.path('credentialsEncrypted').options.select, false);
});
test('AuditLog is append-only (Phase 8 filing history is an embedded array on GSTFiling, not a separate collection)', async () => {
  await assert.rejects(() => models.AuditLog.updateOne({}, { $set: { action: 'LOGIN' } }), /Append-only/);
  await assert.rejects(() => models.AuditLog.deleteMany({}), /Append-only/);
});
test('platform-only permissions are never grantable to tenant users', () => {
  for (const p of ['clients.create', 'vendors.assign', 'audit.view', 'platform.view']) assert.ok(!GRANTABLE_TO_TENANT_USERS.includes(p));
  for (const p of Object.values(ROLE_DEFAULT_PERMISSIONS).flat()) assert.ok(ALL_PERMISSIONS.includes(p), p);
});
test('permission resolution honours grants for client users but ignores platform grants and vendor/master extras', async () => {
  const svc = new PermissionService({ roleRepo: { findByIds: async () => [] }, userRoleRepo: { findByUserId: async () => [] } });
  const cu = await svc.resolve({ role: 'CLIENT_USER', grantedPermissions: ['products.create', 'clients.create'] });
  assert.ok(cu.has('products.create')); assert.ok(!cu.has('clients.create')); assert.ok(!cu.has('products.delete'));
  const vendor = await svc.resolve({ role: 'GST_VENDOR', grantedPermissions: ['products.create'] });
  assert.ok(!vendor.has('products.create')); assert.ok(vendor.has('gst.update_status'));
});
