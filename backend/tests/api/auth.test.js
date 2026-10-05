import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { createHarness, PASSWORD } from '../helpers/harness.js';

const cookieOf = (res, name) => (res.headers['set-cookie'] ?? []).find((c) => c.startsWith(`${name}=`));
const cookieValue = (c) => c.split(';')[0];

test('auth foundation', async (t) => {
  const h = await createHarness();
  const { api, A } = h;

  await t.test('login returns access token + httpOnly SameSite=Strict refresh cookie; no secrets in body', async () => {
    const res = await api.post('/api/v1/auth/login').send({ email: A.admin.email, password: PASSWORD });
    assert.equal(res.status, 200); assert.equal(res.body.success, true); assert.ok(res.body.requestId);
    const c = cookieOf(res, 'refreshToken');
    assert.match(c, /HttpOnly/i); assert.match(c, /SameSite=Strict/i); assert.match(c, /Path=\/api\/v1\/auth/);
    const body = JSON.stringify(res.body);
    for (const leak of ['passwordHash', 'tokenHash', 'refreshToken', '$2a$', '$2b$']) assert.ok(!body.includes(leak), leak);
    assert.equal(res.body.data.user.role, 'CLIENT_ADMIN');
  });

  await t.test('wrong password and unknown user give the same generic error', async () => {
    const a = await api.post('/api/v1/auth/login').send({ email: A.admin.email, password: 'wrong-Password-1' });
    const b = await api.post('/api/v1/auth/login').send({ email: 'nobody@example.test', password: 'wrong-Password-1' });
    assert.equal(a.status, 401); assert.equal(b.status, 401);
    assert.deepEqual(a.body.error, b.body.error);
  });

  await t.test('account locks after repeated failures, even with the right password; failures are audited', async () => {
    const email = A.staff.email;
    for (let i = 0; i < 5; i += 1) await api.post('/api/v1/auth/login').send({ email, password: 'wrong-Password-1' });
    const locked = await api.post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(locked.status, 401);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'LOGIN_FAILED'));
    assert.ok(h.fake.SecurityEvent.docs.some((d) => d.type === 'ACCOUNT_LOCKED'));
  });

  await t.test('NoSQL injection payloads on login are rejected', async () => {
    for (const body of [{ email: { $ne: null }, password: { $ne: null } }, { email: A.admin.email, password: { $gt: '' } }]) {
      const res = await api.post('/api/v1/auth/login').send(body);
      assert.equal(res.status, 400); assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    }
  });

  await t.test('invalid, malformed, expired, and tampered JWTs are rejected', async () => {
    const good = (await h.login(A.admin.email)).token;
    const expired = jwt.sign({ tv: 0 }, process.env.JWT_ACCESS_SECRET, { expiresIn: -5, issuer: 'erp-platform', audience: 'erp-platform-api', subject: String(A.admin._id) });
    const forged = jwt.sign({ tv: 0, role: 'MASTER_ADMIN' }, 'attacker-secret-attacker-secret-0000', { issuer: 'erp-platform', audience: 'erp-platform-api', subject: String(A.admin._id) });
    const tampered = `${good.slice(0, -4)}AAAA`;
    for (const [tok, code] of [['garbage', 'TOKEN_INVALID'], [expired, 'TOKEN_EXPIRED'], [forged, 'TOKEN_INVALID'], [tampered, 'TOKEN_INVALID']]) {
      const res = await api.get('/api/v1/auth/me').set(h.bearer(tok));
      assert.equal(res.status, 401); assert.equal(res.body.error.code, code);
    }
    assert.equal((await api.get('/api/v1/auth/me')).status, 401);
    assert.equal((await api.get('/api/v1/products').set('Authorization', 'Basic abc')).status, 401);
  });

  await t.test('role claimed inside a token is ignored (role comes from the database)', async () => {
    const forgedRole = jwt.sign({ tv: 0, role: 'MASTER_ADMIN', tenantId: String(h.B.tenant._id) }, process.env.JWT_ACCESS_SECRET, { issuer: 'erp-platform', audience: 'erp-platform-api', subject: String(h.A.staff._id) });
    const res = await api.get('/api/v1/clients').set(h.bearer(forgedRole));
    assert.equal(res.status, 403);
  });

  await t.test('refresh rotates the token; reuse of the old token revokes the whole family', async () => {
    const { cookie } = await h.login(h.B.admin.email);
    const c1 = cookieValue(cookie.find((c) => c.startsWith('refreshToken=')));
    const r1 = await api.post('/api/v1/auth/refresh').set('Cookie', c1);
    assert.equal(r1.status, 200); assert.ok(r1.body.data.accessToken);
    const c2 = cookieValue(cookieOf(r1, 'refreshToken'));
    assert.notEqual(c1, c2);
    const reuse = await api.post('/api/v1/auth/refresh').set('Cookie', c1);
    assert.equal(reuse.status, 401);
    assert.ok(h.fake.SecurityEvent.docs.some((d) => d.type === 'TOKEN_REUSE_DETECTED'));
    const afterReuse = await api.post('/api/v1/auth/refresh').set('Cookie', c2);
    assert.equal(afterReuse.status, 401, 'legit descendant token must be revoked after reuse detection');
  });

  await t.test('refresh without or with a forged cookie fails; stored refresh tokens are hashed', async () => {
    assert.equal((await api.post('/api/v1/auth/refresh')).status, 401);
    assert.equal((await api.post('/api/v1/auth/refresh').set('Cookie', 'refreshToken=forged')).status, 401);
    const { cookie } = await h.login(h.master.email);
    const raw = cookieValue(cookie.find((c) => c.startsWith('refreshToken='))).split('=')[1];
    assert.ok(h.fake.RefreshToken.docs.every((d) => d.tokenHash !== raw));
  });

  await t.test('logout revokes the session and is audited', async () => {
    const { cookie } = await h.login(h.vendorUser.email);
    const c = cookieValue(cookie.find((x) => x.startsWith('refreshToken=')));
    assert.equal((await api.post('/api/v1/auth/logout').set('Cookie', c)).status, 200);
    assert.equal((await api.post('/api/v1/auth/refresh').set('Cookie', c)).status, 401);
    assert.ok(h.fake.AuditLog.docs.some((d) => d.action === 'LOGOUT'));
  });

  await t.test('password change revokes existing access and refresh tokens', async () => {
    const { token, cookie } = await h.login(h.A.admin.email);
    const res = await api.post('/api/v1/auth/change-password').set(h.bearer(token)).send({ currentPassword: PASSWORD, newPassword: 'Another-Strong-Pass-9' });
    assert.equal(res.status, 200);
    assert.equal((await api.get('/api/v1/auth/me').set(h.bearer(token))).code ?? 0, 0);
    assert.equal((await api.get('/api/v1/auth/me').set(h.bearer(token))).status, 401);
    assert.equal((await api.post('/api/v1/auth/refresh').set('Cookie', cookieValue(cookie.find((c) => c.startsWith('refreshToken='))))).status, 401);
    assert.equal((await api.post('/api/v1/auth/login').send({ email: h.A.admin.email, password: PASSWORD })).status, 401);
    assert.equal((await api.post('/api/v1/auth/login').send({ email: h.A.admin.email, password: 'Another-Strong-Pass-9' })).status, 200);
  });

  await t.test('weak new password rejected', async () => {
    const { token } = await h.login(h.B.staff.email);
    const res = await api.post('/api/v1/auth/change-password').set(h.bearer(token)).send({ currentPassword: PASSWORD, newPassword: 'short' });
    assert.equal(res.status, 400);
  });

  await t.test('disabled users and suspended tenants lose access immediately', async () => {
    const { token } = await h.login(h.B.admin.email);
    h.fake.Tenant.docs.find((d) => d._id === String(h.B.tenant._id)).status = 'SUSPENDED';
    assert.equal((await api.get('/api/v1/products').set(h.bearer(token))).status, 401);
    assert.equal((await api.post('/api/v1/auth/login').send({ email: h.B.admin.email, password: PASSWORD })).status, 401);
    h.fake.Tenant.docs.find((d) => d._id === String(h.B.tenant._id)).status = 'ACTIVE';
    const u = await h.login(h.B.staff.email);
    h.fake.User.docs.find((d) => d._id === String(h.B.staff._id)).status = 'DISABLED';
    assert.equal((await api.get('/api/v1/auth/me').set(h.bearer(u.token))).status, 401);
  });
});
