import { AuthenticationError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword, DUMMY_HASH } from '../security/password.js';
import {
  signAccessToken, verifyAccessToken, generateRefreshToken, hashRefreshToken, refreshTtlMs, newFamilyId,
} from '../security/tokens.js';
import { ROLES, isTenantRole } from '../constants/roles.js';
import { TENANT_STATUS, USER_STATUS, AUDIT_ACTIONS, SECURITY_EVENT_TYPES } from '../constants/statuses.js';

const INVALID_CREDENTIALS = 'Invalid email or password';

export class AuthService {
  constructor({ userRepo, tenantRepo, vendorRepo, refreshRepo, auditService, securityService, permissionService }) {
    Object.assign(this, { userRepo, tenantRepo, vendorRepo, refreshRepo, auditService, securityService, permissionService });
  }

  /** Returns null when the account may sign in, otherwise an internal reason (never shown to the client). */
  async #accountProblem(user) {
    if (!user || user.isDeleted) return 'account_inactive';
    if (user.status !== USER_STATUS.ACTIVE) return user.status === USER_STATUS.SUSPENDED ? 'account_suspended' : 'account_inactive';
    if (isTenantRole(user.role)) {
      const tenant = await this.tenantRepo.findById(user.tenantId);
      if (!tenant) return 'account_inactive';
      if (tenant.status === TENANT_STATUS.SUSPENDED) return 'account_suspended';
      if (tenant.status !== TENANT_STATUS.ACTIVE) return 'account_inactive';
    }
    if (user.role === ROLES.GST_VENDOR) {
      const vendor = await this.vendorRepo.findById(user.vendorId);
      if (!vendor || vendor.status !== 'ACTIVE') return 'account_inactive';
    }
    return null;
  }

  async #assertAccountUsable(user) {
    if (await this.#accountProblem(user)) throw new AuthenticationError('Account is not active', 'ACCOUNT_INACTIVE');
  }

  async #issueTokens(user, meta, familyId = newFamilyId()) {
    const refreshToken = generateRefreshToken();
    const expiresAt = new Date(Date.now() + refreshTtlMs());
    await this.refreshRepo.create({
      userId: user._id, familyId, tokenHash: hashRefreshToken(refreshToken), expiresAt, createdByIp: meta.ip, userAgent: meta.userAgent,
    });
    return {
      accessToken: signAccessToken({ userId: user._id, tokenVersion: user.tokenVersion }), refreshToken, refreshExpiresAt: expiresAt,
    };
  }

  async login({ email, password }, meta) {
    const user = await this.userRepo.findByEmailWithSecret(email);
    const failure = async (reason, extra = {}) => {
      await this.auditService.record(meta, {
        action: AUDIT_ACTIONS.LOGIN_FAILED, actorId: user?._id, actorRole: user?.role, tenantId: user?.tenantId ?? null,
        resourceType: 'User', resourceId: user?._id, metadata: { reason },
      });
      await this.securityService.record(SECURITY_EVENT_TYPES.LOGIN_FAILED, meta, { userId: user?._id, severity: 'LOW', details: { reason, ...extra } });
      if (reason === 'account_suspended') await this.securityService.record(SECURITY_EVENT_TYPES.ACCOUNT_SUSPENDED, meta, { userId: user?._id, severity: 'MEDIUM' });
      throw new AuthenticationError(INVALID_CREDENTIALS, 'INVALID_CREDENTIALS');
    };

    if (!user) { await verifyPassword(password, DUMMY_HASH); return failure('unknown_user'); }
    if (user.lockUntil && new Date(user.lockUntil) > new Date()) { await verifyPassword(password, DUMMY_HASH); return failure('account_locked'); }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      const lock = attempts >= env.LOGIN_MAX_ATTEMPTS;
      await this.userRepo.updateUnscoped(user._id, {
        $set: { failedLoginAttempts: lock ? 0 : attempts, lockUntil: lock ? new Date(Date.now() + env.LOCKOUT_MINUTES * 60_000) : null },
      });
      if (lock) await this.securityService.record(SECURITY_EVENT_TYPES.ACCOUNT_LOCKED, meta, { userId: user._id, severity: 'HIGH' });
      return failure('bad_password');
    }
    const problem = await this.#accountProblem(user);
    if (problem) return failure(problem);

    await this.userRepo.updateUnscoped(user._id, { $set: { failedLoginAttempts: 0, lockUntil: null, lastLoginAt: new Date() } });
    const tokens = await this.#issueTokens(user, meta);
    await this.auditService.record(meta, {
      action: AUDIT_ACTIONS.LOGIN_SUCCESS, actorId: user._id, actorRole: user.role, tenantId: user.tenantId ?? null, resourceType: 'User', resourceId: user._id,
    });
    return { ...tokens, user: await this.#profile(user) };
  }

  async refresh(rawToken, meta) {
    const invalid = () => new AuthenticationError('Invalid refresh token', 'REFRESH_TOKEN_INVALID');
    if (!rawToken || typeof rawToken !== 'string') throw invalid();
    const hash = hashRefreshToken(rawToken);
    const record = await this.refreshRepo.findByHash(hash);
    if (!record) throw invalid();

    const reuse = async () => {
      await this.refreshRepo.revokeFamily(record.userId, record.familyId);
      const owner = await this.userRepo.findAuthById(record.userId);
      await this.securityService.record(SECURITY_EVENT_TYPES.TOKEN_REUSE_DETECTED, meta, { userId: record.userId, tenantId: owner?.tenantId, severity: 'HIGH', details: { familyId: record.familyId } });
      await this.auditService.record(meta, {
        action: AUDIT_ACTIONS.TOKEN_REUSE_DETECTED, actorId: record.userId, actorRole: owner?.role, tenantId: owner?.tenantId ?? null, resourceType: 'User', resourceId: record.userId, metadata: { familyId: record.familyId },
      });
      throw invalid();
    };
    if (record.revokedAt) return reuse();
    if (new Date(record.expiresAt) <= new Date()) throw invalid();

    const user = await this.userRepo.findAuthById(record.userId);
    try { await this.#assertAccountUsable(user); } catch { await this.refreshRepo.revokeFamily(record.userId, record.familyId); throw invalid(); }

    const next = generateRefreshToken();
    const nextHash = hashRefreshToken(next);
    // Atomic claim: only one concurrent request can rotate a given token.
    const claimed = await this.refreshRepo.markRotated(hash, nextHash);
    if (!claimed) return reuse();
    const expiresAt = new Date(Date.now() + refreshTtlMs());
    await this.refreshRepo.create({
      userId: user._id, familyId: record.familyId, tokenHash: nextHash, expiresAt, createdByIp: meta.ip, userAgent: meta.userAgent,
    });
    await this.auditService.record(meta, {
      action: AUDIT_ACTIONS.TOKEN_REFRESH, actorId: user._id, actorRole: user.role, tenantId: user.tenantId ?? null, resourceType: 'User', resourceId: user._id,
    });
    return { accessToken: signAccessToken({ userId: user._id, tokenVersion: user.tokenVersion }), refreshToken: next, refreshExpiresAt: expiresAt };
  }

  async logout(rawToken, meta) {
    if (!rawToken) return;
    const record = await this.refreshRepo.findByHash(hashRefreshToken(rawToken));
    if (!record) return;
    await this.refreshRepo.revokeFamily(record.userId, record.familyId);
    const user = await this.userRepo.findAuthById(record.userId);
    await this.auditService.record(meta, {
      action: AUDIT_ACTIONS.LOGOUT, actorId: record.userId, actorRole: user?.role, tenantId: user?.tenantId ?? null, resourceType: 'User', resourceId: record.userId,
    });
  }

  async authenticateAccessToken(token) {
    const payload = verifyAccessToken(token);
    const user = await this.userRepo.findAuthById(payload.sub);
    if (!user) throw new AuthenticationError('Invalid access token', 'TOKEN_INVALID');
    if ((user.tokenVersion ?? 0) !== payload.tv) throw new AuthenticationError('Access token revoked', 'TOKEN_REVOKED');
    await this.#assertAccountUsable(user);
    return {
      userId: String(user._id), role: user.role, tenantId: user.tenantId ? String(user.tenantId) : null,
      vendorId: user.vendorId ? String(user.vendorId) : null, permissions: await this.permissionService.resolve(user), user,
    };
  }

  async #profile(user) {
    return {
      id: String(user._id), name: user.name, email: user.email, role: user.role,
      tenantId: user.tenantId ? String(user.tenantId) : null, vendorId: user.vendorId ? String(user.vendorId) : null,
      permissions: [...(await this.permissionService.resolve(user))].sort(),
    };
  }

  profile(auth) { return this.#profile(auth.user); }

  async changePassword(ctx, { currentPassword, newPassword }) {
    const user = await this.userRepo.findAuthById(ctx.actor.id);
    if (!(await verifyPassword(currentPassword, user.passwordHash))) throw new AuthenticationError('Current password is incorrect', 'INVALID_CREDENTIALS');
    await this.userRepo.updateUnscoped(user._id, { $set: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() }, $inc: { tokenVersion: 1 } });
    await this.refreshRepo.revokeAllForUser(user._id);
    await this.auditService.record(ctx, { action: AUDIT_ACTIONS.PASSWORD_CHANGED, resourceType: 'User', resourceId: user._id, tenantId: user.tenantId ?? null });
  }
}