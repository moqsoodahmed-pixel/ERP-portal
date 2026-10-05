import { asyncHandler } from '../utils/asyncHandler.js';
import { AuthorizationError } from '../utils/errors.js';
import { AUDIT_ACTIONS } from '../constants/statuses.js';
import { makeContext } from '../utils/context.js';

const CONNECTOR_SECRET_HEADER = 'x-tally-connector-secret';

/**
 * Phase 16 — authenticates the Windows Tally Connector -> ERP direction. A THIRD, independent credential
 * system: distinct from the human JWT (middlewares/access.js) and the Tally Public API key
 * (middlewares/tallyApiAuth.js) — spec Step 5/7. Tenant identity is resolved ONLY from the authenticated
 * connector record; req.body/query/params tenantId is never consulted (spec Step 8).
 */
export function createTallyConnectorAuthMiddlewares({ tallyConnectorService, auditService }) {
  const authenticate = asyncHandler(async (req, res, next) => {
    const rawSecret = req.get(CONNECTOR_SECRET_HEADER);
    const ctx = { ...makeContext(req), tenantId: null };
    const result = await tallyConnectorService.authenticate(rawSecret, ctx);
    req.connectorAuth = result;
    req.tenantId = result.tenantId;
    next();
  });

  const requireScope = (scope) => asyncHandler(async (req, res, next) => {
    if (!req.connectorAuth?.scopes?.has(scope)) {
      const ctx = { ...makeContext(req), tenantId: req.connectorAuth?.tenantId ?? null };
      await auditService.record(ctx, {
        action: AUDIT_ACTIONS.TALLY_CONNECTOR_SCOPE_DENIED, resourceType: 'TallyConnector', resourceId: req.connectorAuth?.connectorId,
        metadata: { requiredScope: scope, path: req.baseUrl + req.path },
      });
      throw new AuthorizationError('This connector credential does not have the required scope');
    }
    next();
  });

  return { authenticate, requireScope };
}
