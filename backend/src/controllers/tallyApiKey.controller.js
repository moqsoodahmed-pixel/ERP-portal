import { ok, created } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

const ctx = makeContext;

/** Management API for Tally Public API keys — authenticated by the normal ERP JWT (a human admin), not by an API key itself. */
export function createTallyApiKeyController({ tallyApiKeyService }) {
  return {
    list: asyncHandler(async (req, res) => ok(req, res, await tallyApiKeyService.list(ctx(req)))),
    get: asyncHandler(async (req, res) => ok(req, res, await tallyApiKeyService.get(ctx(req), req.params.id))),
    create: asyncHandler(async (req, res) => created(req, res, await tallyApiKeyService.create(ctx(req), req.body),
      'API key created. Store it securely — it will not be shown again.')),
    revoke: asyncHandler(async (req, res) => ok(req, res, await tallyApiKeyService.revoke(ctx(req), req.params.id), 'API key revoked')),
    rotate: asyncHandler(async (req, res) => ok(req, res, await tallyApiKeyService.rotate(ctx(req), req.params.id),
      'API key rotated. Store the new key securely — it will not be shown again.')),
  };
}
