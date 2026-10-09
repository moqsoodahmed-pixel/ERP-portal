import { ok, created } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { makeContext } from '../utils/context.js';

const ctx = makeContext;

/** `req.filing` is populated by access.js's `resolveTenantForFiling` after the full tenant/assignment chain is verified. */
export const createGSTFilingController = ({ gstFilingService }) => ({
  list: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.list(
    { role: req.auth.role, tenantId: req.auth.tenantId, vendorId: req.auth.vendorId }, req.query,
  ))),
  progress: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.progress(
    { role: req.auth.role, tenantId: req.auth.tenantId, vendorId: req.auth.vendorId },
  ))),
  create: asyncHandler(async (req, res) => created(req, res, await gstFilingService.create(ctx(req), req.body), 'GST filing workflow created')),
  get: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.get(ctx(req), req.filing))),
  update: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.update(ctx(req), req.filing, req.body), 'GST filing updated')),
  start: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.transition(ctx(req), req.filing, 'start', req.body?.note), 'Filing started')),
  ready: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.transition(ctx(req), req.filing, 'ready', req.body?.note), 'Filing marked ready for review')),
  submit: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.transition(ctx(req), req.filing, 'submit', req.body?.note), 'Filing submitted')),
  markFiled: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.transition(ctx(req), req.filing, 'markFiled', req.body?.note), 'Filing marked as filed')),

  listIssues: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.listIssues(req.tenantId, req.filing._id))),
  createIssue: asyncHandler(async (req, res) => created(req, res, await gstFilingService.createIssue(ctx(req), req.filing, req.body), 'Issue created')),
  updateIssue: asyncHandler(async (req, res) => ok(req, res, await gstFilingService.updateIssue(ctx(req), req.filing, req.params.issueId, req.body), 'Issue updated')),
});
