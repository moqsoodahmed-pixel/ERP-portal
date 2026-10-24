import crypto from 'node:crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { AuthenticationError, AuthorizationError } from '../utils/errors.js';
import { AUDIT_ACTIONS, SECURITY_EVENT_TYPES, TALLY_API_KEY_STATUS, TALLY_INTEGRATION_STATUS } from '../constants/statuses.js';
import { ROLES } from '../constants/roles.js';
import { isWellFormedApiKey, hashApiKey } from '../security/apiKey.js';
import { makeContext } from '../utils/context.js';

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes window
const seenRequestIds = new Map(); // In-memory replay prevention with TTL

// Clean up expired request IDs periodically
setInterval(() => {
  const cutoff = Date.now() - TIMESTAMP_WINDOW_MS;
  for (const [id, ts] of seenRequestIds.entries()) {
    if (ts < cutoff) seenRequestIds.delete(id);
  }
}, 60 * 1000).unref();

/**
 * Computes canonical HMAC-SHA256 signature for a Tally request.
 */
export function computeTallySignature({ secret, method, path, timestamp, requestId, body = '' }) {
  const cleanMethod = String(method || 'GET').toUpperCase();
  const cleanPath = String(path || '/').split('?')[0];
  const cleanTimestamp = String(timestamp || '');
  const cleanRequestId = String(requestId || '');

  let bodyHash;
  if (body === '' || body === null || body === undefined) {
    bodyHash = crypto.createHash('sha256').update('').digest('hex');
  } else if (typeof body === 'string' || Buffer.isBuffer(body)) {
    bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  } else {
    bodyHash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  const canonicalString = `${cleanMethod}\n${cleanPath}\n${cleanTimestamp}\n${cleanRequestId}\n${bodyHash}`;
  return crypto.createHmac('sha256', secret).update(canonicalString).digest('hex');
}

/**
 * Middleware factory for Tally HMAC Authentication and ERP Admin authorization.
 */
export function createTallyHmacAuthMiddleware({
  tallyApiKeyRepo,
  tallyApiKeyService,
  authService,
  securityService,
  auditService,
  tenantRepo,
  encryption = null,
}) {
  return asyncHandler(async (req, res, next) => {
    const rawApiKey = req.get('x-api-key') || req.get('x-tally-api-key');
    const authHeader = req.get('authorization') || '';

    // ==========================================
    // PATH 1: API KEY + HMAC SIGNATURE AUTHENTICATION
    // ==========================================
    if (rawApiKey) {
      const ctx = { ...makeContext(req), tenantId: null };

      if (!isWellFormedApiKey(rawApiKey)) {
        await securityService.record(SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'LOW', details: { reason: 'MALFORMED_API_KEY' } });
        throw new AuthenticationError('Invalid or malformed API key', 'TALLY_API_KEY_INVALID');
      }

      const keyDoc = await tallyApiKeyRepo.findByHash(hashApiKey(rawApiKey));
      if (!keyDoc) {
        await securityService.record(SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'LOW', details: { reason: 'KEY_NOT_FOUND' } });
        throw new AuthenticationError('Invalid, inactive, or revoked API key', 'TALLY_API_KEY_INVALID');
      }

      // Check status
      if (keyDoc.status === TALLY_INTEGRATION_STATUS.DISABLED) {
        throw new AuthorizationError('Integration is temporarily disabled', 'INTEGRATION_DISABLED');
      }
      if (keyDoc.status === TALLY_INTEGRATION_STATUS.REVOKED) {
        throw new AuthenticationError('Integration has been permanently revoked', 'INTEGRATION_REVOKED');
      }
      if (keyDoc.status !== TALLY_API_KEY_STATUS.ACTIVE && keyDoc.status !== TALLY_INTEGRATION_STATUS.ACTIVE) {
        throw new AuthenticationError('Invalid, inactive, or revoked API key', 'TALLY_API_KEY_INVALID');
      }

      // Expiration check
      if (keyDoc.expiresAt && keyDoc.expiresAt.getTime() < Date.now()) {
        await tallyApiKeyRepo.markExpired(keyDoc._id);
        throw new AuthenticationError('API key has expired', 'TALLY_API_KEY_EXPIRED');
      }

      // 1. IP Allow-list validation (if configured)
      if (Array.isArray(keyDoc.ipAllowList) && keyDoc.ipAllowList.length > 0) {
        const clientIp = req.ip?.replace(/^::ffff:/, '') || '';
        const allowed = keyDoc.ipAllowList.some((ip) => ip === clientIp || ip === req.ip || (ip === '127.0.0.1' && (clientIp === '127.0.0.1' || clientIp === '::1')));
        if (!allowed) {
          await securityService.record(SECURITY_EVENT_TYPES.TALLY_IP_DENIED || SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'HIGH', details: { reason: 'IP_NOT_ALLOWED', clientIp } });
          throw new AuthorizationError('Client IP address not authorized for this API key');
        }
      }

      // 2. Timestamp validation (5 minutes window)
      const rawTimestamp = req.get('x-timestamp') || req.get('x-tally-timestamp');
      if (!rawTimestamp) {
        throw new AuthenticationError('Missing request timestamp header (X-Timestamp)', 'TALLY_TIMESTAMP_REQUIRED');
      }
      const timestampMs = Number(rawTimestamp) || new Date(rawTimestamp).getTime();
      if (isNaN(timestampMs)) {
        throw new AuthenticationError('Invalid request timestamp format', 'TALLY_TIMESTAMP_INVALID');
      }
      const timeSkew = Math.abs(Date.now() - timestampMs);
      if (timeSkew > TIMESTAMP_WINDOW_MS) {
        await securityService.record(SECURITY_EVENT_TYPES.TALLY_TIMESTAMP_SKEW_DETECTED || SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'MEDIUM', details: { skewMs: timeSkew } });
        throw new AuthenticationError('Request timestamp expired or skewed beyond 5 minutes', 'TALLY_TIMESTAMP_EXPIRED');
      }

      // 3. Request ID for idempotency & replay attack prevention
      const requestId = req.get('x-request-id') || req.get('x-tally-request-id');
      if (!requestId) {
        throw new AuthenticationError('Missing request ID header (X-Request-Id) for idempotency', 'TALLY_REQUEST_ID_REQUIRED');
      }
      if (seenRequestIds.has(requestId)) {
        await securityService.record(SECURITY_EVENT_TYPES.TALLY_REPLAY_ATTACK_DETECTED || SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'HIGH', details: { requestId } });
        throw new AuthenticationError('Duplicate request ID detected (potential replay attack)', 'TALLY_REQUEST_REPLAY');
      }

      // 4. Secret retrieval and HMAC verification (supports active secret or previous secret during rotation grace period)
      let rawSecret = tallyApiKeyService ? tallyApiKeyService.getSecret(keyDoc) : null;
      if (!rawSecret && encryption && keyDoc.encryptedSecret) {
        try { rawSecret = encryption.decrypt(keyDoc.encryptedSecret); } catch {}
      }

      if (!rawSecret) {
        throw new AuthenticationError('API Key credentials could not be decrypted', 'TALLY_CREDENTIAL_ERROR');
      }

      const rawSignature = req.get('x-signature') || req.get('x-tally-signature');
      if (!rawSignature) {
        throw new AuthenticationError('Missing request signature header (X-Signature)', 'TALLY_SIGNATURE_REQUIRED');
      }

      const path = (req.originalUrl || req.url || req.path).split('?')[0];

      // Helper to check signature with a given secret
      const verifySignature = (secret) => {
        const bodyCandidates = [];
        if (req.method === 'GET' || req.method === 'HEAD') {
          bodyCandidates.push('');
        }
        if (req.rawBody !== undefined && req.rawBody !== null) {
          bodyCandidates.push(req.rawBody);
        }
        if (req.body !== undefined && req.body !== null) {
          bodyCandidates.push(req.body);
          if (typeof req.body === 'object') {
            if (Object.keys(req.body).length === 0) {
              bodyCandidates.push('');
            }
            bodyCandidates.push(JSON.stringify(req.body));
          }
        }
        if (bodyCandidates.length === 0) {
          bodyCandidates.push('');
        }

        const sigBuf = Buffer.from(rawSignature.toLowerCase(), 'hex');
        for (const candidate of bodyCandidates) {
          const expectedSignature = computeTallySignature({
            secret,
            method: req.method,
            path,
            timestamp: rawTimestamp,
            requestId,
            body: candidate,
          });
          const expectedBuf = Buffer.from(expectedSignature.toLowerCase(), 'hex');
          if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
            return true;
          }
        }
        return false;
      };

      let isValid = verifySignature(rawSecret);

      // Grace period fallback: if primary secret failed, test previous secret if still in rotation grace period
      if (!isValid && keyDoc.previousEncryptedSecret && keyDoc.previousKeyGraceExpiresAt) {
        if (keyDoc.previousKeyGraceExpiresAt.getTime() > Date.now()) {
          try {
            const encService = encryption || tallyApiKeyService?.encryption;
            const prevSecret = encService ? encService.decrypt(keyDoc.previousEncryptedSecret) : null;
            if (prevSecret && verifySignature(prevSecret)) {
              isValid = true;
            }
          } catch {}
        }
      }

      if (!isValid) {
        await securityService.record(SECURITY_EVENT_TYPES.TALLY_HMAC_AUTH_FAILED || SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, { severity: 'MEDIUM', details: { reason: 'INVALID_SIGNATURE' } });
        throw new AuthenticationError('Invalid request signature', 'TALLY_SIGNATURE_INVALID');
      }

      // Mark request ID as seen
      seenRequestIds.set(requestId, timestampMs);

      // Touch key last used & IP
      await tallyApiKeyRepo.touchLastUsed(keyDoc._id).catch(() => {});
      if (req.ip) {
        if (typeof tallyApiKeyRepo.model?.updateOne === 'function') {
          await tallyApiKeyRepo.model.updateOne({ _id: keyDoc._id }, { $set: { lastIpAddress: req.ip } }).catch(() => {});
        } else if (typeof tallyApiKeyRepo.model?.updateMany === 'function') {
          await tallyApiKeyRepo.model.updateMany({ _id: keyDoc._id }, { $set: { lastIpAddress: req.ip } }).catch(() => {});
        }
      }

      const tenant = await tenantRepo.findById(keyDoc.tenantId);
      req.tallyAuth = {
        mode: 'API_KEY',
        tenantId: String(keyDoc.tenantId),
        apiKeyId: String(keyDoc._id),
        integrationId: keyDoc.integrationId || String(keyDoc._id),
        companyCode: tenant?.companyCode || null,
        name: keyDoc.name,
        permissions: keyDoc.permissions || ['Bills.Read', 'Bills.Write', 'Bills.Status', 'Bills.Retry', 'Bills.Export', 'Bills.Sync'],
      };
      req.tenantId = String(keyDoc.tenantId);
      req.id = requestId;
      return next();
    }

    // ==========================================
    // PATH 2: ERP ADMIN SESSION (JWT BEARER)
    // ==========================================
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const auth = await authService.authenticateAccessToken(token);
      req.auth = auth;

      // CLIENT_ADMIN, CLIENT_USER, and GST_VENDOR are strictly forbidden from accessing Tally module
      if (
        auth.role === ROLES.CLIENT_ADMIN ||
        auth.role === ROLES.CLIENT_USER ||
        auth.role === ROLES.GST_VENDOR
      ) {
        const ctx = makeContext(req);
        await securityService.record(SECURITY_EVENT_TYPES.UNAUTHORIZED_ACCESS, ctx, {
          severity: 'HIGH',
          userId: auth.userId,
          details: { role: auth.role, reason: 'TALLY_MODULE_RESTRICTED' },
        });
        await auditService.record(ctx, {
          action: AUDIT_ACTIONS.UNAUTHORIZED_ACCESS_ATTEMPT,
          resourceType: 'TallyModule',
          metadata: { role: auth.role, path: req.originalUrl },
        });
        throw new AuthorizationError('Client Admin and Vendor are not permitted to access Tally synchronization operations');
      }

      // MASTER_ADMIN has unrestricted monitoring & retry capabilities
      if (auth.role === ROLES.MASTER_ADMIN) {
        req.tallyAuth = {
          mode: 'ERP_ADMIN',
          role: ROLES.MASTER_ADMIN,
          userId: auth.userId,
          allTenants: true,
          permissions: ['Bills.Read', 'Bills.Write', 'Bills.Status', 'Bills.Retry', 'Bills.Export', 'Bills.Sync', '*'],
        };
        const requestedTenant = req.get('x-admin-tenant-id') || req.query.tenantId || req.body?.tenantId;
        if (requestedTenant) {
          req.tenantId = String(requestedTenant);
        }
        return next();
      }

      // MASTER_ASSISTANT_ADMIN has access ONLY for assigned organizations
      if (auth.role === ROLES.MASTER_ASSISTANT_ADMIN) {
        const assigned = (auth.assignedTenantIds || []).map(String);
        req.tallyAuth = {
          mode: 'ERP_ADMIN',
          role: ROLES.MASTER_ASSISTANT_ADMIN,
          userId: auth.userId,
          assignedTenantIds: assigned,
          permissions: ['Bills.Read', 'Bills.Write', 'Bills.Status', 'Bills.Retry', 'Bills.Export', 'Bills.Sync', '*'],
        };
        const requestedTenant = req.get('x-admin-tenant-id') || req.query.tenantId || req.body?.tenantId;
        if (requestedTenant) {
          if (!assigned.includes(String(requestedTenant))) {
            throw new AuthorizationError('Assistant Admin cannot access organizations outside their assignment');
          }
          req.tenantId = String(requestedTenant);
        }
        return next();
      }

      throw new AuthorizationError('Unauthorized to access Tally integration module');
    }

    // ==========================================
    // PATH 3: NO CREDENTIALS PROVIDED
    // ==========================================
    throw new AuthenticationError(
      'Authentication required: provide valid API Key with HMAC signature or ERP admin session',
      'AUTHENTICATION_REQUIRED',
    );
  });
}

/**
 * Middleware to enforce granular integration permissions (e.g. Bills.Write, Bills.Read, etc.).
 */
export function requireTallyScope(requiredScope) {
  return (req, res, next) => {
    if (!req.tallyAuth) {
      throw new AuthenticationError('Authentication required');
    }

    if (req.tallyAuth.mode === 'ERP_ADMIN') {
      return next(); // Admins bypass granular API key scopes
    }

    const perms = req.tallyAuth.permissions || [];
    if (!perms.includes(requiredScope) && !perms.includes('*')) {
      throw new AuthorizationError(
        `Integration lacks required permission: ${requiredScope}`,
        'INSUFFICIENT_INTEGRATION_PERMISSIONS',
      );
    }

    return next();
  };
}
