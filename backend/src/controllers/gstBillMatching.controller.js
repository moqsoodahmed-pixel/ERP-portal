import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

export function createGSTBillMatchingController({ gstBillMatchingService }) {
  return {
    get: asyncHandler(async (req, res) => ok(req, res, await gstBillMatchingService.get(makeContext(req), req.filing))),
    run: asyncHandler(async (req, res) => ok(req, res, await gstBillMatchingService.run(makeContext(req), req.filing), 'Tally matching completed')),
  };
}
