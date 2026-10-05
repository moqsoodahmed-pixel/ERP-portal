import { ok, created } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

const ctx = makeContext;

/**
 * Admin-facing connector management — authenticated by the normal ERP JWT (a human Master Admin), exactly
 * like tallyApiKey.controller.js. This is where a connector credential is minted (spec Step 25 "Register
 * Connector" / "Revoke Connector" / "Rotate Credential"); the Windows connector itself never calls these.
 */
export function createTallyConnectorController({ tallyConnectorService }) {
  return {
    list: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.list(ctx(req)))),
    get: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.get(ctx(req), req.params.id))),
    register: asyncHandler(async (req, res) => created(req, res, await tallyConnectorService.register(ctx(req), req.body),
      'Connector registered. Store the credential securely — it will not be shown again.')),
    revoke: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.revoke(ctx(req), req.params.id), 'Connector revoked')),
    rotate: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.rotate(ctx(req), req.params.id),
      'Connector credential rotated. Store the new credential securely — it will not be shown again.')),
  };
}

const connectorCtx = (req) => ({ ...ctx(req), tenantId: req.connectorAuth.tenantId, actor: { id: req.connectorAuth.connectorId } });

/**
 * Connector-facing API (spec Step 7) — authenticated by the dedicated connector secret
 * (middlewares/tallyConnectorAuth.js), never the ERP JWT or the Tally Public API key.
 */
export function createTallyConnectorApiController({ tallyConnectorService, tallyJobService }) {
  return {
    status: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.get(connectorCtx(req), req.connectorAuth.connectorId))),
    heartbeat: asyncHandler(async (req, res) => ok(req, res, await tallyConnectorService.heartbeat(connectorCtx(req), req.connectorAuth.connectorId, req.body))),
    listJobs: asyncHandler(async (req, res) => {
      const jobs = await tallyJobService.listClaimable(req.connectorAuth);
      await tallyConnectorService.recordPoll(req.connectorAuth.connectorId);
      ok(req, res, jobs);
    }),
    claim: asyncHandler(async (req, res) => ok(req, res, await tallyJobService.claim(req.connectorAuth, req.params.jobId))),
    result: asyncHandler(async (req, res) => ok(req, res, await tallyJobService.reportResult(req.connectorAuth, req.params.jobId, req.body))),
  };
}
