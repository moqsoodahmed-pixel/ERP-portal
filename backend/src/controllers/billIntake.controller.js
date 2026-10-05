import { ok, created } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

const ctx = makeContext;
/** `req.bill` is populated by access.js's `resolveTenantForBill` after the full tenant/assignment chain is verified. */
const authCtx = (req) => ({ role: req.auth.role, tenantId: req.auth.tenantId, vendorId: req.auth.vendorId });

export const createBillIntakeController = ({ billIntakeService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.list(authCtx(req), req.query))),
  create: asyncHandler(async (req, res) => created(req, res, await billIntakeService.create(ctx(req), req.body), 'Bill saved as draft')),
  get: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.get(ctx(req), req.bill))),
  update: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.update(ctx(req), req.bill, req.body), 'Bill updated')),

  addDocuments: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.addDocuments(ctx(req), req.bill, req.body.documents), 'Documents uploaded')),
  getDocument: asyncHandler(async (req, res) => {
    const { buffer, fileName, mimeType } = await billIntakeService.getDocument(ctx(req), req.bill, req.params.docId);
    const safeName = String(fileName ?? 'document').replace(/[^A-Za-z0-9-_.]/g, '_');
    res.setHeader('Content-Type', mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.status(200).send(buffer);
  }),

  submit: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.submit(ctx(req), req.bill, req.body?.note), 'Bill submitted')),
  review: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.review(ctx(req), req.bill, req.body?.note), 'Bill reviewed')),
  reject: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.reject(ctx(req), req.bill, req.body.reason), 'Bill rejected')),

  tallyProcessingStarted: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.tallyProcessingStarted(ctx(req), req.bill), 'Marked as processing in Tally')),
  tallySynced: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.tallySynced(ctx(req), req.bill, req.body.tallyReference), 'Bill marked synced to Tally')),
  tallyFailed: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.tallyFailed(ctx(req), req.bill, req.body.reason), 'Tally failure recorded')),
  tallyRetry: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.tallyRetry(ctx(req), req.bill), 'Bill re-queued for Tally')),
  complete: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.complete(ctx(req), req.bill), 'Bill marked completed')),

  queue: asyncHandler(async (req, res) => ok(req, res, await billIntakeService.queue(authCtx(req), req.query))),
});
