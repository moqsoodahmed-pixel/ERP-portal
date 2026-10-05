import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** Context for the Tally Public API: tenant comes from the authenticated API key, never from the request. */
const ctx = (req) => ({
  tenantId: req.tallyAuth.tenantId,
  actor: { id: `tally-api-key:${req.tallyAuth.apiKeyId}`, role: 'TALLY_API_KEY' },
  ip: req.ip,
  userAgent: req.get('user-agent')?.slice(0, 300),
  requestId: req.id,
});

export function createTallyPublicApiController({ tallyPublicApiService }) {
  return {
    company: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.company(ctx(req)))),
    customers: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.customers(ctx(req), req.query))),
    products: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.products(ctx(req), req.query))),
    invoices: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.invoices(ctx(req), req.query))),
    invoice: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.invoice(ctx(req), req.params.id))),
    sync: asyncHandler(async (req, res) => ok(req, res, await tallyPublicApiService.sync(ctx(req), req.params.id), 'Tally sync requested')),
  };
}
