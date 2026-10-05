import { asyncHandler } from '../utils/asyncHandler.js';
import { AuthorizationError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';
import { makeContext } from '../utils/context.js';

const API_KEY_HEADER = 'x-tally-api-key';

/**
 * Phase 13 — authenticates the Tally/TDL -> ERP direction. Deliberately separate from the JWT
 * `authenticate` middleware (middlewares/access.js): there is no human user/session here, only a
 * tenant-bound API key. Resolves tenantId/scopes from the KEY record only — nothing from the request
 * body/query/headers is ever trusted as tenant or scope identity (see tallyApiKey.service.js#authenticate).
 */
export function createTallyApiAuthMiddlewares({ tallyApiKeyService, auditService }) {
  const authenticate = asyncHandler(async (req, res, next) => {
    const rawKey = req.get(API_KEY_HEADER);
    // ctx has no tenantId yet — that is exactly what authenticate() is about to resolve (or reject).
    const ctx = { ...makeContext(req), tenantId: null };
    const result = await tallyApiKeyService.authenticate(rawKey, ctx);
    req.tallyAuth = result;
    req.tenantId = result.tenantId; // consumed by downstream services exactly like req.tenantId from resolveTenant
    next();
  });

  const requireScope = (scope) => asyncHandler(async (req, res, next) => {
    if (!req.tallyAuth?.scopes?.has(scope)) {
      const ctx = { ...makeContext(req), tenantId: req.tallyAuth?.tenantId ?? null };
      await auditService.record(ctx, {
        action: AUDIT_ACTIONS.TALLY_API_SCOPE_DENIED, resourceType: 'TallyApiKey', resourceId: req.tallyAuth?.apiKeyId,
        metadata: { requiredScope: scope, path: req.baseUrl + req.path },
      });
      throw new AuthorizationError('This API key does not have the required scope');
    }
    next();
  });

  return { authenticate, requireScope };
}
