import '../helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeModel } from '../helpers/fakeModel.js';
import { TenantRepository } from '../../src/repositories/tenant.repository.js';
import { parsePagination, parseSort } from '../../src/utils/pagination.js';

const T1 = 'a'.repeat(24); const T2 = 'b'.repeat(24);
const setup = async () => {
  const repo = new TenantRepository(new FakeModel('X'), { searchFields: ['name'] });
  const d1 = await repo.create(T1, { name: 'one' });
  const d2 = await repo.create(T2, { name: 'two' });
  return { repo, d1, d2 };
};

test('every method requires a valid tenant id', async () => {
  const { repo } = await setup();
  for (const bad of [undefined, null, '', 'not-an-id', { $ne: null }]) {
    await assert.rejects(() => repo.findPage(bad), (e) => e.code === 'TENANT_ACCESS_ERROR');
    await assert.rejects(() => repo.create(bad, {}), (e) => e.code === 'TENANT_ACCESS_ERROR');
  }
});
test('cross-tenant read by id returns nothing', async () => {
  const { repo, d2 } = await setup();
  assert.equal(await repo.findOneById(T1, d2._id), null);
  assert.ok(await repo.findOneById(T2, d2._id));
});
test('filter cannot override tenant scope', async () => {
  const { repo } = await setup();
  const r = await repo.findPage(T1, { filter: { tenantId: T2 } });
  assert.deepEqual(r.items.map((i) => i.name), ['one']);
});
test('create ignores tenantId smuggled in payload; update cannot move a record to another tenant', async () => {
  const { repo, d1 } = await setup();
  const c = await repo.create(T1, { name: 'x', tenantId: T2 });
  assert.equal(c.tenantId, T1);
  const u = await repo.updateById(T1, d1._id, { name: 'renamed', tenantId: T2 });
  assert.equal(u.tenantId, T1); assert.equal(u.name, 'renamed');
});
test('cross-tenant update / soft delete affect nothing', async () => {
  const { repo, d2 } = await setup();
  assert.equal(await repo.updateById(T1, d2._id, { name: 'hacked' }), null);
  assert.equal(await repo.softDeleteById(T1, d2._id, 'u'), null);
  assert.equal((await repo.findOneById(T2, d2._id)).name, 'two');
});
test('soft-deleted rows are hidden but remain stored', async () => {
  const { repo, d1 } = await setup();
  await repo.softDeleteById(T1, d1._id, 'u');
  assert.equal(await repo.findOneById(T1, d1._id), null);
  assert.equal(repo.model.docs.length >= 2, true);
});
test('search is regex-escaped (no injection) and limit is capped', async () => {
  const { repo } = await setup();
  const r = await repo.findPage(T1, { search: '.*', limit: 100000 });
  assert.equal(r.items.length, 0); assert.equal(r.limit, 100);
});
test('pagination helpers enforce bounds and sort whitelist', () => {
  assert.equal(parsePagination({ limit: '9999' }).limit, 100);
  assert.equal(parsePagination({ page: '-4' }).page, 1);
  assert.deepEqual(parseSort('-name,passwordHash', ['name']), { name: -1 });
  assert.deepEqual(parseSort('passwordHash', ['name']), { createdAt: -1 });
});
